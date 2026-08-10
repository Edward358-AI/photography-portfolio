#!/usr/bin/env node
/**
 * Photo ingestion pipeline.
 *
 * Reads Lightroom-exported JPEGs from  staging/<category>/*.jpg , then:
 *   1. extracts EXIF (camera, lens, focal length, aperture, shutter, ISO, date)
 *   2. generates AVIF + WebP variants at 640 / 1080 / 1920 / 3840 px (never upscaled)
 *   3. generates a tiny blurred WebP data-URI placeholder (LQIP)
 *   4. uploads variants to Cloudflare R2 (or public/images/ with --local)
 *   5. writes one content entry per photo to src/content/photos/<id>.json
 *
 * Re-runs are idempotent (tracked in scripts/ingest/manifest.json by content
 * hash). Hand-edited fields in existing JSON (title, alt, location, tags,
 * featured) are preserved on re-ingest.
 *
 * Usage:
 *   npm run ingest -- --local            # no R2 needed; writes to public/images/
 *   npm run ingest                       # uploads to R2 (.env credentials)
 *   npm run ingest -- --dry-run          # show what would happen
 *   npm run ingest -- --featured --location "RIAT, Fairford" --tags airshow,raf
 *   npm run ingest -- --force            # re-process files already in the manifest
 *
 * GPS coordinates are never copied out of the originals: sharp strips all
 * metadata from generated variants, and the GPS tags are never written to JSON.
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { exiftool } from 'exiftool-vendored';
import sharp from 'sharp';

// Keep in sync with CATEGORIES in src/site.config.ts
const CATEGORIES = ['aviation', 'landscape', 'cityscape', 'nature'];
const TARGET_WIDTHS = [640, 1080, 1920, 3840];
const INPUT_EXT = /\.(jpe?g|png)$/i;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONTENT_DIR = path.join(ROOT, 'src', 'content', 'photos');
const MANIFEST_PATH = path.join(ROOT, 'scripts', 'ingest', 'manifest.json');
const LOCAL_IMAGE_DIR = path.join(ROOT, 'public', 'images');

const { values: args } = parseArgs({
  options: {
    local: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
    featured: { type: 'boolean', default: false },
    location: { type: 'string' },
    tags: { type: 'string' },
    staging: { type: 'string', default: 'staging' },
    help: { type: 'boolean', default: false },
  },
});

if (args.help) {
  console.log('See the header of scripts/ingest/index.mjs for usage.');
  process.exit(0);
}

const dryRun = args['dry-run'];
const storage = args.local ? 'local' : 'r2';

/* ------------------------------------------------------------ helpers --- */

async function loadDotEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!existsSync(envPath)) return;
  const text = await readFile(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const value = m[2].replace(/^["']|["']$/g, '');
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}

const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'photo';

/** "IMG_4123-edit" -> "IMG 4123 edit" */
const humanize = (s) => s.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();

function exifDate(v) {
  if (!v) return undefined;
  if (typeof v.toDate === 'function') {
    const d = v.toDate();
    return Number.isNaN(+d) ? undefined : d;
  }
  if (typeof v === 'string') {
    const m = v.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}:\d{2}:\d{2})/);
    const d = m ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}`) : new Date(v);
    return Number.isNaN(+d) ? undefined : d;
  }
  return undefined;
}

function fmtShutter(v) {
  if (v == null) return undefined;
  if (typeof v === 'string') {
    const s = v.trim();
    if (s.includes('/')) return s.endsWith('s') ? s : `${s}s`;
    const n = Number(s);
    return Number.isNaN(n) ? s : fmtShutter(n);
  }
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return undefined;
  if (v >= 1) return `${Math.round(v * 10) / 10}s`;
  return `1/${Math.round(1 / v)}s`;
}

function fmtAperture(v) {
  const n = typeof v === 'string' ? Number.parseFloat(v.replace(/^f\/?/i, '')) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
  return `f/${Number(n.toFixed(1))}`;
}

function fmtFocal(v) {
  const n = typeof v === 'string' ? Number.parseFloat(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
  return `${Number(n.toFixed(1))}mm`;
}

function fmtCamera(make, model) {
  if (!model) return make || undefined;
  if (!make) return model;
  const firstWord = make.split(/\s+/)[0].toLowerCase();
  return model.toLowerCase().startsWith(firstWord) ? model : `${make} ${model}`;
}

const omitUndefined = (obj) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

/* ----------------------------------------------------------- R2 client --- */

let r2 = null;
let PutObjectCommand = null;
let publicBase = '';

async function initR2() {
  const missing = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'PUBLIC_IMAGE_BASE_URL'].filter(
    (k) => !process.env[k],
  );
  if (missing.length) {
    console.error(
      `Missing in .env: ${missing.join(', ')}\n` +
        'Either fill in your R2 credentials (see .env.example) or run with --local to skip R2 entirely.',
    );
    process.exit(1);
  }
  const s3 = await import('@aws-sdk/client-s3');
  PutObjectCommand = s3.PutObjectCommand;
  r2 = new s3.S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  publicBase = process.env.PUBLIC_IMAGE_BASE_URL.replace(/\/+$/, '');
}

async function storeVariant(id, filename, buffer, contentType) {
  const key = `photos/${id}/${filename}`;
  if (storage === 'local') {
    const dir = path.join(LOCAL_IMAGE_DIR, 'photos', id);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, filename), buffer);
    return `/images/${key}`;
  }
  await r2.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
  return `${publicBase}/${key}`;
}

/* -------------------------------------------------------------- main ---- */

async function main() {
  await loadDotEnv();
  if (!dryRun && storage === 'r2') await initR2();

  const stagingDir = path.resolve(ROOT, args.staging);
  if (!existsSync(stagingDir)) {
    console.error(
      `Staging directory not found: ${stagingDir}\n` +
        `Create it with one subfolder per category (${CATEGORIES.join(', ')}) and drop exported JPEGs inside.\n` +
        'Tip: `npm run fixtures` generates sample images for testing.',
    );
    process.exit(1);
  }

  const manifest = existsSync(MANIFEST_PATH) ? JSON.parse(await readFile(MANIFEST_PATH, 'utf8')) : {};
  const batch = [];
  for (const entry of await readdir(stagingDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      if (INPUT_EXT.test(entry.name))
        console.warn(`! Skipping ${entry.name} — put files inside a category folder (${CATEGORIES.join(', ')})`);
      continue;
    }
    if (!CATEGORIES.includes(entry.name)) {
      console.warn(`! Skipping folder "${entry.name}" — not a category (${CATEGORIES.join(', ')})`);
      continue;
    }
    for (const file of await readdir(path.join(stagingDir, entry.name))) {
      if (INPUT_EXT.test(file)) batch.push({ category: entry.name, file: path.join(stagingDir, entry.name, file) });
    }
  }

  if (!batch.length) {
    console.log('Nothing to ingest — staging is empty.');
    return;
  }
  console.log(`Ingesting ${batch.length} file(s) → ${storage === 'local' ? 'public/images/ (local mode)' : `R2 bucket "${process.env.R2_BUCKET}"`}${dryRun ? ' [dry run]' : ''}\n`);

  await mkdir(CONTENT_DIR, { recursive: true });
  let done = 0;
  let skipped = 0;
  let failed = 0;

  for (const { category, file } of batch) {
    const name = path.basename(file);
    const t0 = Date.now();
    try {
      const buf = await readFile(file);
      const hash = createHash('sha256').update(buf).digest('hex');
      const known = manifest[hash];

      if (known && known.storage === storage && !args.force) {
        skipped++;
        console.log(`- ${name}: already ingested as ${known.id} (use --force to redo)`);
        continue;
      }

      const base = path.basename(file).replace(INPUT_EXT, '');
      const id = known?.id ?? `${slugify(base)}-${hash.slice(0, 8)}`;

      // --- EXIF ---------------------------------------------------------
      const tags = await exiftool.read(file);
      const exif = omitUndefined({
        camera: fmtCamera(tags.Make, tags.Model),
        lens: tags.LensModel || tags.LensID || tags.Lens || undefined,
        focalLength: fmtFocal(tags.FocalLength),
        aperture: fmtAperture(tags.FNumber),
        shutterSpeed: fmtShutter(tags.ExposureTime),
        iso: typeof tags.ISO === 'number' ? tags.ISO : undefined,
      });
      const date = exifDate(tags.DateTimeOriginal) ?? exifDate(tags.CreateDate) ?? (await stat(file)).mtime;

      // --- dimensions (orientation-corrected) ----------------------------
      const md = await sharp(buf).metadata();
      let width = md.width ?? 0;
      let height = md.height ?? 0;
      if ((md.orientation ?? 1) >= 5) [width, height] = [height, width];
      if (!width || !height) throw new Error('could not read image dimensions');

      const widths = TARGET_WIDTHS.filter((w) => w <= width);
      if (!widths.length) widths.push(width);

      if (dryRun) {
        console.log(`~ ${name}: ${width}x${height} → id ${id}, variants ${widths.join('/')}px, exif ${JSON.stringify(exif)}`);
        continue;
      }

      // --- variants -------------------------------------------------------
      const oriented = sharp(buf, { failOn: 'none' }).rotate();
      const variants = [];
      for (const w of widths) {
        const [avifBuf, webpBuf] = await Promise.all([
          oriented.clone().resize({ width: w, withoutEnlargement: true }).avif({ quality: 55, effort: 4 }).toBuffer(),
          oriented.clone().resize({ width: w, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer(),
        ]);
        const [avif, webp] = await Promise.all([
          storeVariant(id, `${w}.avif`, avifBuf, 'image/avif'),
          storeVariant(id, `${w}.webp`, webpBuf, 'image/webp'),
        ]);
        variants.push({ width: w, avif, webp });
      }

      const lqipBuf = await oriented.clone().resize({ width: 24 }).blur(1).webp({ quality: 20 }).toBuffer();
      const lqip = `data:image/webp;base64,${lqipBuf.toString('base64')}`;

      // --- content entry (preserve hand-edited fields on re-ingest) -------
      const jsonPath = path.join(CONTENT_DIR, `${id}.json`);
      let existing = {};
      if (existsSync(jsonPath)) {
        try {
          existing = JSON.parse(await readFile(jsonPath, 'utf8'));
        } catch {
          existing = {};
        }
      }
      const entry = omitUndefined({
        title: existing.title ?? humanize(base),
        alt: existing.alt ?? humanize(base),
        date: (existing.date && new Date(existing.date).toISOString()) || date.toISOString(),
        category: existing.category ?? category,
        featured: existing.featured ?? args.featured,
        image: { width, height, lqip, variants },
        exif: Object.keys(exif).length ? exif : undefined,
        location: existing.location ?? args.location,
        tags: existing.tags ?? (args.tags ? args.tags.split(',').map((t) => t.trim()).filter(Boolean) : []),
      });
      await writeFile(jsonPath, JSON.stringify(entry, null, 2) + '\n');

      manifest[hash] = { id, storage, source: name, ingestedAt: new Date().toISOString() };
      await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');

      done++;
      console.log(`+ ${name} → ${id} (${width}x${height}, ${variants.length}x2 variants, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    } catch (err) {
      failed++;
      process.exitCode = 1;
      console.error(`x ${name}: ${err?.message ?? err}`);
    }
  }

  console.log(`\nDone: ${done} ingested, ${skipped} skipped, ${failed} failed.`);
  if (done && !dryRun) {
    console.log('Review/edit titles, alt text, locations and tags in src/content/photos/*.json, then commit.');
    if (storage === 'local')
      console.log('(local mode: variants in public/images/ are gitignored — re-run without --local once R2 is set up)');
  }
}

try {
  await main();
} finally {
  await exiftool.end();
}
