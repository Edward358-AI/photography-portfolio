#!/usr/bin/env node
/**
 * Print-copy metadata stripper.
 *
 * Takes full-resolution exports (Edward exports these from Lightroom without
 * the watermark) and produces send-ready copies in print-out/ with ALL
 * metadata removed — EXIF, GPS, XMP, everything. The strip is done by
 * exiftool, which rewrites metadata blocks only: pixels are untouched, no
 * re-encode, no quality loss.
 *
 * Usage:
 *   npm run printcopy -- path/to/export.jpg [more.jpg ...]
 */

import { copyFile, mkdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exiftool } from 'exiftool-vendored';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'print-out');

const files = process.argv.slice(2).filter((a) => !a.startsWith('-'));
if (!files.length) {
  console.log('Usage: npm run printcopy -- <export.jpg> [more.jpg ...]');
  process.exit(1);
}

await mkdir(OUT_DIR, { recursive: true });

try {
  for (const file of files) {
    if (!existsSync(file)) {
      console.error(`x ${file}: not found`);
      process.exitCode = 1;
      continue;
    }
    const dest = path.join(OUT_DIR, path.basename(file));
    await copyFile(file, dest);
    await exiftool.deleteAllTags(dest);
    await rm(`${dest}_original`, { force: true }); // exiftool's in-place backup

    // Trust but verify: read back and make sure nothing sensitive survived.
    const tags = await exiftool.read(dest);
    const leftovers = Object.keys(tags).filter((k) =>
      /^(GPS|Make|Model|Artist|Creator|Copyright|Serial|Lens|DateTimeOriginal|CreateDate)/i.test(k),
    );
    const size = ((await stat(dest)).size / 1024 / 1024).toFixed(1);
    if (leftovers.length) {
      console.error(`! ${path.basename(dest)}: tags survived the strip: ${leftovers.join(', ')}`);
      process.exitCode = 1;
    } else {
      console.log(`+ ${path.basename(dest)} → print-out/ (${size} MB, metadata clean)`);
    }
  }
} finally {
  await exiftool.end();
}
