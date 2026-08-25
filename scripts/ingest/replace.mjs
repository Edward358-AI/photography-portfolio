#!/usr/bin/env node
/**
 * Photo replacement pipeline — for re-exports of already-ingested photos.
 *
 * IDs contain the content hash, so a re-edited export (even with the same
 * filename) ingests as a brand-new photo and leaves the old one behind. This
 * script automates the swap. It finds staging files whose filename matches a
 * manifest entry but whose content hash differs, then:
 *   1. runs the normal ingest for them (new id, new variants, new JSON)
 *   2. copies hand-edited fields (title, alt, date, featured, location, tags)
 *      from the old entry to the new one
 *   3. deletes the old content JSON and manifest entry
 *   4. deletes the old variants from R2 (or public/images/ for local entries)
 *
 * Usage:
 *   npm run replace                      # overwrite the export in staging/, then run this
 *   npm run replace -- --dry-run         # show what would be replaced, touch nothing
 *   npm run replace -- --local           # ingest new variants locally instead of R2
 *
 * Renamed files are NOT treated as replacements (a new name means a new photo
 * as far as this script can tell) — handle those manually.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const CATEGORIES = ['aviation', 'landscape', 'cityscape', 'street', 'nature'];
const INPUT_EXT = /\.(jpe?g|png)$/i;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONTENT_DIR = path.join(ROOT, 'src', 'content', 'photos');
const MANIFEST_PATH = path.join(ROOT, 'scripts', 'ingest', 'manifest.json');
const LOCAL_IMAGE_DIR = path.join(ROOT, 'public', 'images');
const INGEST_SCRIPT = path.join(ROOT, 'scripts', 'ingest', 'index.mjs');

const { values: args } = parseArgs({
  options: {
    local: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    staging: { type: 'string', default: 'staging' },
    help: { type: 'boolean', default: false },
  },
});

if (args.help) {
  console.log('See the header of scripts/ingest/replace.mjs for usage.');
  process.exit(0);
}

const dryRun = args['dry-run'];

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

/** JSON.parse that tolerates a UTF-8 BOM (Windows editors/shells add them). */
const parseJson = (text) => JSON.parse(text.replace(/^﻿/, ''));

const loadManifest = async () =>
  existsSync(MANIFEST_PATH) ? parseJson(await readFile(MANIFEST_PATH, 'utf8')) : {};

async function deleteOldVariants(entry) {
  if (entry.storage === 'local') {
    await rm(path.join(LOCAL_IMAGE_DIR, 'photos', entry.id), { recursive: true, force: true });
    return 'public/images/';
  }
  const s3 = await import('@aws-sdk/client-s3');
  const r2 = new s3.S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  const Bucket = process.env.R2_BUCKET;
  const Prefix = `photos/${entry.id}/`;
  const list = await r2.send(new s3.ListObjectsV2Command({ Bucket, Prefix }));
  const objects = (list.Contents ?? []).map((o) => ({ Key: o.Key }));
  if (objects.length) {
    const res = await r2.send(new s3.DeleteObjectsCommand({ Bucket, Delete: { Objects: objects } }));
    if (res.Errors?.length) throw new Error(`R2 delete failed: ${JSON.stringify(res.Errors)}`);
  }
  const check = await r2.send(new s3.ListObjectsV2Command({ Bucket, Prefix }));
  if (check.KeyCount) throw new Error(`${check.KeyCount} object(s) still present under ${Prefix}`);
  return `R2 (${objects.length} objects)`;
}

async function main() {
  await loadDotEnv();

  const stagingDir = path.resolve(ROOT, args.staging);
  if (!existsSync(stagingDir)) {
    console.error(`Staging directory not found: ${stagingDir}`);
    process.exit(1);
  }

  // --- detect: staged files with a known filename but an unknown hash -------
  const manifest = await loadManifest();
  const bySource = new Map();
  for (const [hash, entry] of Object.entries(manifest)) {
    if (!bySource.has(entry.source)) bySource.set(entry.source, []);
    bySource.get(entry.source).push({ hash, ...entry });
  }

  const replacements = [];
  for (const dirent of await readdir(stagingDir, { withFileTypes: true })) {
    if (!dirent.isDirectory() || !CATEGORIES.includes(dirent.name)) continue;
    for (const file of await readdir(path.join(stagingDir, dirent.name))) {
      if (!INPUT_EXT.test(file)) continue;
      const buf = await readFile(path.join(stagingDir, dirent.name, file));
      const hash = createHash('sha256').update(buf).digest('hex');
      if (manifest[hash]) continue; // unchanged since last ingest
      const old = bySource.get(file) ?? [];
      if (old.length > 1) {
        console.warn(`! ${file}: matches ${old.length} manifest entries — handle this one manually`);
        continue;
      }
      if (old.length === 1) replacements.push({ file, newHash: hash, old: old[0] });
    }
  }

  if (!replacements.length) {
    console.log('Nothing to replace — no staged file re-uses a known filename with new content.');
    return;
  }

  for (const r of replacements) console.log(`~ ${r.file}: will replace ${r.old.id}`);
  if (dryRun) {
    console.log(`\n[dry run] ${replacements.length} replacement(s) detected, nothing touched.`);
    return;
  }

  // --- ingest the new exports (normal pipeline, new ids) --------------------
  const ingestArgs = [INGEST_SCRIPT, ...(args.local ? ['--local'] : []), '--staging', args.staging];
  const res = spawnSync(process.execPath, ingestArgs, { stdio: 'inherit' });
  if (res.status !== 0) {
    console.error('\nIngest failed — old entries left untouched.');
    process.exit(1);
  }

  // --- migrate metadata, then remove every trace of the old ids -------------
  const updated = await loadManifest();
  let done = 0;
  for (const { file, newHash, old } of replacements) {
    const fresh = updated[newHash];
    if (!fresh) {
      console.error(`x ${file}: not found in manifest after ingest — old entry ${old.id} left untouched`);
      process.exitCode = 1;
      continue;
    }

    const oldJsonPath = path.join(CONTENT_DIR, `${old.id}.json`);
    const newJsonPath = path.join(CONTENT_DIR, `${fresh.id}.json`);
    if (existsSync(oldJsonPath)) {
      const oldEntry = parseJson(await readFile(oldJsonPath, 'utf8'));
      const newEntry = parseJson(await readFile(newJsonPath, 'utf8'));
      for (const key of ['title', 'alt', 'date', 'featured', 'location', 'tags']) {
        if (oldEntry[key] !== undefined) newEntry[key] = oldEntry[key];
      }
      await writeFile(newJsonPath, JSON.stringify(newEntry, null, 2) + '\n');
      await unlink(oldJsonPath);
    }

    delete updated[old.hash];
    await writeFile(MANIFEST_PATH, JSON.stringify(updated, null, 2) + '\n');

    const where = await deleteOldVariants(old);
    done++;
    console.log(`+ ${file}: ${old.id} → ${fresh.id} (metadata carried over, old variants removed from ${where})`);
  }

  console.log(`\nDone: ${done} of ${replacements.length} replaced.`);
  if (done) console.log('Review the new JSON (the re-export may look different — check the alt text), then commit.');
}

await main();
