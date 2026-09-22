#!/usr/bin/env node
/**
 * Print-request inbox.
 *
 * Lists print requests written by the /api/print-request Pages Function into
 * the private `print-requests` R2 bucket, and archives or deletes them.
 *
 * Usage:
 *   npm run requests                    # list pending requests
 *   npm run requests -- --done <id>     # archive to done/ after fulfilling
 *   npm run requests -- --purge <id>    # delete outright (spam)
 *
 * Uses the same .env R2 credentials as ingest, plus optional
 * PRINT_REQUESTS_BUCKET (defaults to "print-requests").
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { values: args } = parseArgs({
  options: {
    done: { type: 'string' },
    purge: { type: 'string' },
    help: { type: 'boolean', default: false },
  },
});

if (args.help) {
  console.log('See the header of scripts/requests.mjs for usage.');
  process.exit(0);
}

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

await loadDotEnv();
const missing = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing in .env: ${missing.join(', ')}`);
  process.exit(1);
}
const BUCKET = process.env.PRINT_REQUESTS_BUCKET || 'print-requests';

const s3 = await import('@aws-sdk/client-s3');
const r2 = new s3.S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

/** Accepts a bare id, a filename, or a full key. */
const toPendingKey = (id) => {
  let k = id.replace(/^pending\//, '').replace(/\.json$/, '');
  return `pending/${k}.json`;
};

if (args.done || args.purge) {
  const key = toPendingKey(args.done ?? args.purge);
  if (args.done) {
    await r2.send(
      new s3.CopyObjectCommand({
        Bucket: BUCKET,
        CopySource: encodeURIComponent(`${BUCKET}/${key}`),
        Key: key.replace(/^pending\//, 'done/'),
      }),
    );
  }
  await r2.send(new s3.DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  console.log(`${args.done ? 'Archived' : 'Deleted'} ${key}`);
  process.exit(0);
}

const list = await r2.send(new s3.ListObjectsV2Command({ Bucket: BUCKET, Prefix: 'pending/' }));
const objects = (list.Contents ?? []).sort((a, b) => (a.Key < b.Key ? -1 : 1));
if (!objects.length) {
  console.log('No pending print requests.');
  process.exit(0);
}

console.log(`${objects.length} pending request(s):\n`);
for (const o of objects) {
  const res = await r2.send(new s3.GetObjectCommand({ Bucket: BUCKET, Key: o.Key }));
  const id = o.Key.replace(/^pending\//, '').replace(/\.json$/, '');
  let req;
  try {
    req = JSON.parse(await res.Body.transformToString());
  } catch {
    console.log(`--- ${id}\n  (unparseable JSON — likely junk; purge with --purge ${id})\n`);
    continue;
  }
  console.log(`--- ${id}`);
  console.log(`  ${req.name ?? '?'} <${req.email ?? '?'}>${req.country ? `  [${req.country}]` : ''}  ${req.at ?? ''}`);
  for (const p of req.photos ?? []) console.log(`  • "${p.title}" — ${p.size}, ${p.finish}`);
  if (req.notes) console.log(`  notes: ${req.notes}`);
  console.log(`  done:  npm run requests -- --done ${id}\n`);
}
