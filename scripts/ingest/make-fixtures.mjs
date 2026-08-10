#!/usr/bin/env node
/**
 * Generates placeholder JPEGs (gradients + label text) with realistic EXIF
 * written into them, so the whole ingest → gallery pipeline can be exercised
 * without real photos. Output goes to staging/<category>/, same as a real
 * Lightroom export would.
 *
 * Usage: npm run fixtures
 */

import { mkdir, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exiftool } from 'exiftool-vendored';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STAGING = path.join(ROOT, 'staging');

const CANON_R5 = { Make: 'Canon', Model: 'Canon EOS R5' };
const SONY_A7R5 = { Make: 'Sony', Model: 'ILCE-7RM5' };
const FUJI_XT5 = { Make: 'FUJIFILM', Model: 'X-T5' };

const FIXTURES = [
  // aviation — long lens, fast shutter
  { cat: 'aviation', name: 'f18-hornet-pass', w: 3000, h: 2000, c: ['#1c2e4a', '#5b7ea6', '#dfe8f2'],
    exif: { ...CANON_R5, LensModel: 'RF100-500mm F4.5-7.1 L IS USM', FNumber: 7.1, ExposureTime: '1/2000', ISO: 400, FocalLength: '500', DateTimeOriginal: '2026:05:16 11:42:07' } },
  { cat: 'aviation', name: 'heavy-departure-dusk', w: 3200, h: 1800, c: ['#2b1d3a', '#b0533a', '#f2c17d'],
    exif: { ...CANON_R5, LensModel: 'RF100-500mm F4.5-7.1 L IS USM', FNumber: 5.6, ExposureTime: '1/1250', ISO: 1600, FocalLength: '300', DateTimeOriginal: '2026:04:02 19:58:31' } },
  { cat: 'aviation', name: 'prop-blur-taxi', w: 2000, h: 3000, c: ['#22303c', '#4b6272', '#9fb3c0'],
    exif: { ...SONY_A7R5, LensModel: 'FE 200-600mm F5.6-6.3 G OSS', FNumber: 8, ExposureTime: '1/125', ISO: 100, FocalLength: '420', DateTimeOriginal: '2026:03:14 14:05:52' } },
  { cat: 'aviation', name: 'formation-break', w: 3240, h: 1200, c: ['#10151c', '#31506b', '#89b0d0'],
    exif: { ...CANON_R5, LensModel: 'RF100-500mm F4.5-7.1 L IS USM', FNumber: 7.1, ExposureTime: '1/2500', ISO: 500, FocalLength: '451', DateTimeOriginal: '2026:05:16 13:20:44' } },
  // landscape — tripod, low ISO
  { cat: 'landscape', name: 'alpine-lake-dawn', w: 3200, h: 1800, c: ['#14343b', '#3c7068', '#e8b84b'],
    exif: { ...SONY_A7R5, LensModel: 'FE 16-35mm F2.8 GM II', FNumber: 11, ExposureTime: '1/8', ISO: 100, FocalLength: '16', DateTimeOriginal: '2025:10:11 06:48:19' } },
  { cat: 'landscape', name: 'ridge-light', w: 3000, h: 2000, c: ['#1f2d24', '#5a7c4f', '#d8c690'],
    exif: { ...FUJI_XT5, LensModel: 'XF16-55mmF2.8 R LM WR', FNumber: 8, ExposureTime: '1/60', ISO: 125, FocalLength: '35', DateTimeOriginal: '2025:11:23 16:12:03' } },
  { cat: 'landscape', name: 'desert-monolith', w: 2000, h: 2500, c: ['#31201c', '#8a4b32', '#e0a06a'],
    exif: { ...SONY_A7R5, LensModel: 'FE 24-70mm F2.8 GM II', FNumber: 13, ExposureTime: '1/30', ISO: 100, FocalLength: '24', DateTimeOriginal: '2026:01:04 17:31:56' } },
  // cityscape — night, wide aperture
  { cat: 'cityscape', name: 'blue-hour-skyline', w: 3200, h: 1800, c: ['#141a33', '#33427a', '#c78e5a'],
    exif: { ...SONY_A7R5, LensModel: 'FE 24-70mm F2.8 GM II', FNumber: 8, ExposureTime: '4', ISO: 100, FocalLength: '48', DateTimeOriginal: '2025:12:19 17:44:28' } },
  { cat: 'cityscape', name: 'alley-neon', w: 2000, h: 3000, c: ['#1c1230', '#6a2f7a', '#e05c8a'],
    exif: { ...FUJI_XT5, LensModel: 'XF35mmF1.4 R', FNumber: 1.4, ExposureTime: '1/60', ISO: 1600, FocalLength: '35', DateTimeOriginal: '2026:02:07 21:03:12' } },
  // nature — telephoto wildlife
  { cat: 'nature', name: 'heron-takeoff', w: 3000, h: 2000, c: ['#16261e', '#3f6b4e', '#b9d1a8'],
    exif: { ...CANON_R5, LensModel: 'RF100-500mm F4.5-7.1 L IS USM', FNumber: 7.1, ExposureTime: '1/1600', ISO: 800, FocalLength: '500', DateTimeOriginal: '2026:06:21 07:15:40' } },
  { cat: 'nature', name: 'forest-fog', w: 2200, h: 2200, c: ['#1a2320', '#46584d', '#93a68f'],
    exif: { ...FUJI_XT5, LensModel: 'XF16-55mmF2.8 R LM WR', FNumber: 4, ExposureTime: '1/250', ISO: 640, FocalLength: '55', DateTimeOriginal: '2025:09:28 08:02:17' } },
];

function svg({ w, h, c, label }) {
  const r = Math.min(w, h);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${c[0]}"/><stop offset="0.55" stop-color="${c[1]}"/><stop offset="1" stop-color="${c[2]}"/>
    </linearGradient>
    <radialGradient id="v" cx="0.5" cy="0.45" r="0.8">
      <stop offset="0.6" stop-color="rgba(0,0,0,0)"/><stop offset="1" stop-color="rgba(0,0,0,0.45)"/>
    </radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#g)"/>
  <circle cx="${w * 0.72}" cy="${h * 0.3}" r="${r * 0.18}" fill="${c[2]}" opacity="0.35"/>
  <circle cx="${w * 0.25}" cy="${h * 0.68}" r="${r * 0.3}" fill="${c[0]}" opacity="0.3"/>
  <rect width="${w}" height="${h}" fill="url(#v)"/>
  <text x="${w / 2}" y="${h / 2}" fill="rgba(255,255,255,0.85)" font-family="Arial, sans-serif" font-size="${r * 0.07}" font-weight="bold" text-anchor="middle" dominant-baseline="middle">${label}</text>
  <text x="${w / 2}" y="${h / 2 + r * 0.09}" fill="rgba(255,255,255,0.55)" font-family="Arial, sans-serif" font-size="${r * 0.035}" text-anchor="middle" dominant-baseline="middle">${w} x ${h} fixture</text>
</svg>`;
}

try {
  let count = 0;
  for (const f of FIXTURES) {
    const dir = path.join(STAGING, f.cat);
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${f.name}.jpg`);
    const image = svg({ w: f.w, h: f.h, c: f.c, label: f.name.replace(/-/g, ' ') });
    await sharp(Buffer.from(image)).jpeg({ quality: 88, mozjpeg: true }).toFile(file);
    await exiftool.write(file, f.exif);
    count++;
    console.log(`+ staging/${f.cat}/${f.name}.jpg (${f.w}x${f.h})`);
  }

  // exiftool leaves "<name>.jpg_original" backups behind — remove them
  for (const cat of new Set(FIXTURES.map((f) => f.cat))) {
    const dir = path.join(STAGING, cat);
    for (const file of await readdir(dir)) {
      if (file.endsWith('_original')) await unlink(path.join(dir, file));
    }
  }
  console.log(`\n${count} fixture(s) written to staging/. Next: npm run ingest -- --local`);
} finally {
  await exiftool.end();
}
