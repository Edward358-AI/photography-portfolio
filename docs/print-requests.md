# Print requests — implementation plan

Free hobby prints: visitors request up to 3 photos by title, Edward emails them
full-size files. No revenue, no payment, no third-party services — everything
runs on the Cloudflare stack the site already uses (Pages + R2).

```
visitor → /prints/ form (static HTML, no JS)
        → POST /api/print-request (Cloudflare Pages Function, same repo/deploy)
        → JSON object in PRIVATE R2 bucket "print-requests" (pending/)

Edward  → npm run requests            # list + read pending requests
        → export full-size from Lightroom (no watermark)
        → npm run printcopy -- <file> # lossless metadata strip → print-out/
        → reply to requester's email with the file(s)
        → npm run requests -- --done <id>
```

## 1. The page — `src/pages/prints/index.astro`

Plain HTML form, dark theme, same layout shell as About. **Zero client JS.**

| Field | Element | Constraints (client) |
| --- | --- | --- |
| Name | `<input type="text">` | required, `maxlength=100` |
| Email | `<input type="email">` | required, `maxlength=200` |
| Photo 1–3: title | `<input list="photo-titles">` | #1 required, #2–3 optional; `maxlength=120` |
| Photo 1–3: size | `<input type="text">` | `pattern="\s*\d{1,2}\s*[xX×]\s*\d{1,2}\s*"`, placeholder `8x10`, required when its title is filled |
| Photo 1–3: finish | radios `matte` / `glossy` | required when its title is filled |
| Notes | `<textarea>` | optional, `maxlength=500` |
| Honeypot | `<input name="website">` hidden via CSS | must stay empty; bots fill it |

- `<datalist id="photo-titles">` is generated **at build time** from the photos
  content collection — type-ahead over every real title, always current, no JS.
- Size is free-text but forced into `N x N` (inches) by the pattern; the same
  regex is enforced server-side. Page notes that standard sizes may crop 3:2
  and pano frames and that Edward confirms details by email before sending.
- Success → Function issues a `303` redirect to static `/prints/thanks/`.
- All page copy ships as clearly-marked placeholder for Edward to rewrite.

## 2. The endpoint — `functions/api/print-request.ts`

Cloudflare Pages Function (Workers runtime), deployed automatically with the
repo. Accepts `application/x-www-form-urlencoded` POST only.

Server-side validation (reject → `303` back to `/prints/?error=1`; the page
shows a static error hint via `:target`-free CSS or a query-param note):

- name: 1–100 chars. email: basic RFC-ish regex, ≤200 chars.
- photos: 1–3 entries; each needs title (1–120 chars), size matching
  `^\s*\d{1,2}\s*[xX×]\s*\d{1,2}\s*$`, finish ∈ {matte, glossy}.
- notes ≤500 chars. Total request body capped at 8 KB.
- Honeypot filled → pretend success (redirect to thanks), write nothing.

On success, `PUT` one object via the **R2 binding** (no credentials in code):

```
pending/2026-09-05T18-22-31Z-x7f3kq.json
{ "at": "...", "name": "...", "email": "...", "country": cf.country,
  "photos": [{ "title": "...", "size": "8x10", "finish": "matte" }],
  "notes": "..." }
```

Only `country` from request metadata is stored — no IP, no user agent.

### Is the API publicly callable?

Yes — unavoidably, since the public form must reach it. What that exposes:

- **No secrets**: the Function holds no credentials; R2 access is a binding.
  Nothing an attacker can read back — the endpoint only ever answers with a
  redirect. The bucket is private, unlisted, and on no domain.
- **Worst case is junk**: a bot or curl user can write spam JSON into
  `pending/`. Blast radius = clutter Edward deletes. R2 free tier includes
  1M writes/month; a flood costs nothing but annoyance.
- **v1 mitigations**: honeypot, strict validation, 8 KB body cap, POST-only,
  same-origin form (no CORS headers offered).
- **Escalation path if spam ever appears** (in order): Cloudflare WAF
  rate-limiting rule on `/api/*` (free tier includes one rule) → Cloudflare
  Turnstile on the form (first-party, adds the only JS on the page) →
  worst case, delete the Function file and the endpoint is gone.

## 3. Edward's CLI — `scripts/requests.mjs`

`npm run requests` — lists `pending/` and pretty-prints each request
(name, email, photos/sizes/finishes, notes, date, country).

`npm run requests -- --done <id>` — copies the object to `done/` and removes
it from `pending/` (fulfilled archive). `--purge <id>` deletes outright (spam).

Uses the S3 API with the existing `.env` credentials plus one new line:
`PRINT_REQUESTS_BUCKET=print-requests`. If the current R2 API token turns out
to be scoped to the photos bucket only, mint one more token for this bucket
and it becomes two new `.env` lines instead.

## 4. Metadata stripper — `scripts/printcopy.mjs`

`npm run printcopy -- <exported.jpg> [more.jpg ...]`

- Input: fresh full-size Lightroom exports (Edward exports these without the
  watermark; the staging originals keep theirs).
- Runs exiftool (`-all=`) for a **lossless** strip — no re-encode, pixels
  untouched, GPS and all other EXIF removed.
- Output: `print-out/<same-name>.jpg`, ready to attach to the reply email.
- `print-out/` is gitignored.

## 5. Config touches

- `src/site.config.ts`: add `{ label: 'Prints', href: '/prints/' }` to nav.
- `package.json`: `requests` and `printcopy` scripts.
- `.gitignore`: `print-out/`.
- README: short "Print requests" section (how it works, dashboard setup).

## 6. One-time Cloudflare dashboard setup (Edward, ~5 min)

1. R2 → create bucket `print-requests` (private; no public access, no domain).
2. Pages project → Settings → Bindings → R2 bucket binding:
   name `REQUESTS` → bucket `print-requests`.
3. Redeploy (next push does it) so the Function picks up the binding.

## 7. Testing plan

1. `npm run build` then `npx wrangler pages dev dist` locally (Astro's dev
   server does not run Pages Functions).
2. curl the endpoint: valid request → object appears (local R2 simulation);
   missing email / bad size / 4 photos / filled honeypot → rejected or
   silently dropped as designed.
3. Browser pane: submit the real form end-to-end, check thanks page, verify
   datalist type-ahead and the size pattern's native validation bubble.
4. `npm run requests` against the real bucket after one live test submission;
   `--done` it. `npm run printcopy` on a sample export; confirm EXIF gone
   (exiftool read-back) and bytes otherwise identical.
5. Post-deploy smoke test on edj-photo.com.

## Decisions locked

- No third-party services; Cloudflare only. No email notifications — Edward
  polls with `npm run requests`.
- Cap: 3 photos per request (server-enforced). Bucket: `print-requests`.
- Size: free-text `N x N` inches, both ends validated.
- Watermark handling: Edward exports print copies without watermark;
  `printcopy` only strips metadata.
- Navbar gets a third item: Photos · Prints · About.
- v1 ships without Turnstile; escalation path documented above.
