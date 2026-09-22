/**
 * Print-request endpoint (Cloudflare Pages Function).
 *
 * Receives the /prints/ form POST, validates it, and writes one JSON object
 * per request into the private `print-requests` R2 bucket via the REQUESTS
 * binding (configured in the Pages dashboard — no credentials in code).
 * Edward reads requests with `npm run requests`.
 *
 * Public by necessity; defenses: honeypot field, strict validation, 8 KB
 * body cap. Failure never echoes input — every response is a redirect.
 */

interface R2BucketLite {
  put(key: string, value: string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
}

interface Env {
  REQUESTS: R2BucketLite;
}

const SIZE_RE = /^\s*\d{1,2}\s*[x×]\s*\d{1,2}\s*$/i;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
const FINISHES = new Set(['matte', 'glossy']);

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }): Promise<Response> => {
  const url = new URL(request.url);
  const redirect = (path: string) => Response.redirect(new URL(path, url).toString(), 303);

  const raw = await request.text();
  if (raw.length > 8192) return redirect('/prints/error/');
  const form = new URLSearchParams(raw);
  const get = (k: string) => (form.get(k) ?? '').trim();

  // Honeypot: bots fill the hidden field. Pretend success, store nothing.
  if (get('website') !== '') return redirect('/prints/thanks/');

  const name = get('name');
  const email = get('email');
  const notes = get('notes');
  if (!name || name.length > 100) return redirect('/prints/error/');
  if (email.length > 200 || !EMAIL_RE.test(email)) return redirect('/prints/error/');
  if (notes.length > 500) return redirect('/prints/error/');

  const photos: Array<{ title: string; size: string; finish: string }> = [];
  for (const i of [1, 2, 3]) {
    const title = get(`p${i}_title`);
    const size = get(`p${i}_size`);
    const finish = get(`p${i}_finish`);
    if (!title && !size && !finish) continue; // untouched optional block
    if (!title || title.length > 120 || !SIZE_RE.test(size) || !FINISHES.has(finish))
      return redirect('/prints/error/');
    photos.push({ title, size: size.replace(/\s+/g, '').toLowerCase().replace('×', 'x'), finish });
  }
  if (photos.length === 0) return redirect('/prints/error/');

  const at = new Date().toISOString();
  const id = `${at.replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 6)}`;
  const country = (request as { cf?: { country?: string } }).cf?.country ?? '';
  await env.REQUESTS.put(
    `pending/${id}.json`,
    JSON.stringify({ at, name, email, country, photos, notes }, null, 2),
    { httpMetadata: { contentType: 'application/json' } },
  );
  return redirect('/prints/thanks/');
};
