# Photography Portfolio

Static, photo-centric portfolio: [Astro 5](https://astro.build) + Tailwind CSS v4, with an
automated ingestion pipeline that extracts EXIF, generates AVIF/WebP variants, and uploads to
Cloudflare R2. Pages ship almost zero JavaScript; builds never touch image bytes.

```
Lightroom export → staging/<category>/*.jpg
  → npm run ingest        EXIF → variants (AVIF+WebP × 640/1080/1920/3840) → LQIP
                          → upload to R2 → src/content/photos/<id>.json
  → git push              → Cloudflare Pages build (seconds — static only) → edge
```

## Local development (no Cloudflare account needed)

```bash
npm install
npm run fixtures            # generate sample images with realistic EXIF (demo only)
npm run ingest -- --local   # process into public/images/ instead of R2
npm run dev                 # http://localhost:4321
```

`npm run build && npm run preview` serves the exact production build locally.

## Adding photos (the real workflow)

1. Export full-resolution JPEGs from Lightroom into `staging/<category>/`
   (categories: `aviation`, `landscape`, `cityscape`, `nature`)
2. `npm run ingest` (or `-- --local` before R2 is set up)
3. Polish the generated entries in `src/content/photos/*.json` — title, alt text,
   `featured: true`, location, tags. **Hand edits survive re-ingestion.**
4. Commit and push. Done — Cloudflare Pages rebuilds the site.

### Ingest flags

| Flag | Effect |
| --- | --- |
| `--local` | write variants to `public/images/` and use local URLs (no R2) |
| `--dry-run` | show what would be processed, touch nothing |
| `--force` | re-process files already in the manifest |
| `--featured` | mark the whole batch featured |
| `--location "RIAT, Fairford"` | set location for the batch |
| `--tags airshow,raf` | set tags for the batch |

Re-runs are idempotent (files tracked by content hash in `scripts/ingest/manifest.json`).

### Replacing a photo (re-edited export)

IDs contain the content hash, so a re-export is a *new* photo — plain `ingest` would leave
the old one behind. Instead, overwrite the export in `staging/<category>/` (same filename)
and run `npm run replace`: it ingests the new version, carries the old entry's title/alt/
location/tags/featured over, and deletes the old JSON, manifest entry and R2 variants.
`--dry-run` previews; renamed files are not detected — handle those manually.
GPS EXIF is never published: variants are stripped of all metadata, and GPS tags are never
written to content JSON.

## Going live — one-time Cloudflare setup

1. **Cloudflare account** (free) → enable **R2** (requires a payment card on file; the free
   tier — 10 GB storage, zero egress — costs $0 and holds thousands of photos)
2. Create a bucket (e.g. `photography-portfolio`) → **Settings → Public access**:
   connect a **custom domain** (recommended) or enable the `r2.dev` URL (rate-limited, fine to start)
3. **Manage R2 API Tokens** → create a token with *Object Read & Write* → copy
   `cp .env.example .env` and fill in the credentials + `PUBLIC_IMAGE_BASE_URL`
4. Re-upload existing photos to R2: `npm run ingest -- --force` (originals still in `staging/`)
5. **Workers & Pages → Create → Pages → Connect to Git** → pick this repo
   Build command `npm run build`, output directory `dist`. Every push now deploys.
6. Update `site` in [astro.config.mjs](astro.config.mjs) and the `Sitemap:` line in
   [public/robots.txt](public/robots.txt) to your final domain.

## Removing the demo content

Delete `src/content/photos/*.json`, `scripts/ingest/manifest.json`, `staging/`, and
`public/images/`, then ingest your real photos. Also personalize
[src/site.config.ts](src/site.config.ts) and [src/pages/about.astro](src/pages/about.astro).

## Version notes

- Pinned to **Astro 5** because this machine runs Node 20 (Astro 6+ requires Node ≥22.12),
  and to **exiftool-vendored 35** (36+ requires Node ≥22). Node 20 reached end-of-life in
  April 2026 — when convenient: install Node 22/24 LTS, then `npx @astrojs/upgrade` and bump
  `exiftool-vendored`. The content-collection APIs used here already match the v6+ shape.
- Licensed AGPL-3.0 (see [LICENSE](LICENSE)); photographs are all rights reserved.

## How it stays fast

- Strict SSG — every page is static HTML; image work happens once at ingest, never at build
- `<picture>` AVIF → WebP with 640/1080/1920/3840 srcsets, explicit dimensions (zero CLS)
- ~400-byte blurred `data:` URI placeholders — blur-up with no decoding JavaScript
- Justified gallery rows in pure CSS (`flex-grow` ∝ aspect ratio) — no masonry library
- EXIF (title, camera, settings) appears as a pure-CSS hover overlay on each photo; clicking
  enlarges the photo (capped at 1000px on the long side) with the same caption. One small
  inlined script handles the blur-up fade and the viewer
- First 6 images `loading="eager" fetchpriority="high"`; the rest lazy-load
