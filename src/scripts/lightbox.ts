/**
 * Gallery runtime: image blur-up fades + the <dialog> lightbox.
 * The only client-side JavaScript on photo pages (~3 KB min+gz).
 */

type Variant = { width: number; avif: string; webp: string };
type Photo = {
  id: string;
  title: string;
  alt: string;
  location: string | null;
  date: string;
  exif: {
    camera?: string;
    lens?: string;
    focalLength?: string;
    aperture?: string;
    shutterSpeed?: string;
    iso?: number;
  } | null;
  w: number;
  h: number;
  variants: Variant[];
};

/* ---- blur-up: fade every gallery image in once its bytes arrive ---------- */

const markLoaded = (img: HTMLImageElement) => img.classList.add('ld');
document.addEventListener(
  'load',
  (e) => {
    if (e.target instanceof HTMLImageElement) markLoaded(e.target);
  },
  true,
);
for (const img of document.querySelectorAll('img')) {
  if (img.complete && img.naturalWidth > 0) markLoaded(img);
}

/* ---- lightbox ------------------------------------------------------------ */

const dialog = document.getElementById('lightbox') as HTMLDialogElement | null;
const dataEl = document.getElementById('lightbox-data');

if (dialog && dataEl) {
  const photos: Photo[] = JSON.parse(dataEl.textContent ?? '[]');
  const frame = dialog.querySelector<HTMLElement>('[data-lb-frame]')!;
  const stage = dialog.querySelector<HTMLElement>('[data-lb-stage]')!;
  const titleEl = dialog.querySelector<HTMLElement>('[data-lb-title]')!;
  const subEl = dialog.querySelector<HTMLElement>('[data-lb-sub]')!;
  const exifEl = dialog.querySelector<HTMLElement>('[data-lb-exif]')!;
  const counterEl = dialog.querySelector<HTMLElement>('[data-lb-counter]')!;

  let index = -1;
  let closingFromPopstate = false;

  const webpSrcset = (p: Photo) => p.variants.map((v) => `${v.webp} ${v.width}w`).join(', ');

  const buildPicture = (p: Photo) => {
    const pic = document.createElement('picture');
    const source = document.createElement('source');
    source.type = 'image/avif';
    source.srcset = p.variants.map((v) => `${v.avif} ${v.width}w`).join(', ');
    source.sizes = '100vw';
    const img = document.createElement('img');
    img.src = p.variants[p.variants.length - 1].webp;
    img.srcset = webpSrcset(p);
    img.sizes = '100vw';
    img.alt = p.alt;
    img.decoding = 'async';
    img.style.aspectRatio = `${p.w} / ${p.h}`;
    pic.append(source, img);
    return pic;
  };

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const renderMeta = (p: Photo) => {
    titleEl.textContent = p.title;
    subEl.textContent = [p.location, fmtDate(p.date)].filter(Boolean).join(' · ');
    exifEl.replaceChildren(
      ...[
        p.exif?.camera,
        p.exif?.lens,
        p.exif?.focalLength,
        p.exif?.aperture,
        p.exif?.shutterSpeed,
        p.exif?.iso != null ? `ISO ${p.exif.iso}` : undefined,
      ]
        .filter((v): v is string => Boolean(v))
        .map((text) => {
          const s = document.createElement('span');
          s.textContent = text;
          return s;
        }),
    );
    counterEl.textContent = `${index + 1} / ${photos.length}`;
  };

  const preload = (i: number) => {
    const p = photos[(i + photos.length) % photos.length];
    const best = p.variants.find((v) => v.width >= 1920) ?? p.variants[p.variants.length - 1];
    new Image().src = best.webp;
  };

  const show = (i: number) => {
    index = (i + photos.length) % photos.length;
    const p = photos[index];
    const apply = () => {
      frame.replaceChildren(buildPicture(p));
      renderMeta(p);
    };
    if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const t = document.startViewTransition(apply);
      // skipped/aborted transitions (rapid arrow-keying, hidden tab) are fine
      t.ready.catch(() => {});
      t.finished.catch(() => {});
    } else {
      apply();
    }
    // keep the deep link in sync however the photo was reached (buttons, keys, swipe)
    history.replaceState(history.state, '', `#p:${p.id}`);
    preload(index + 1);
    preload(index - 1);
  };

  const open = (i: number, push: boolean) => {
    const wasOpen = dialog.open;
    if (!wasOpen) dialog.showModal();
    // extra entry so the browser Back button closes the lightbox (via popstate)
    if (push && !wasOpen) history.pushState({ lb: true }, '', location.href);
    show(i);
  };

  const idFromHash = (hash: string) => {
    const m = hash.match(/^#p:(.+)$/);
    return m ? decodeURIComponent(m[1]) : null;
  };

  const indexOfId = (id: string | null) => (id === null ? -1 : photos.findIndex((p) => p.id === id));

  // only ever strips our own #p: fragments; no history.back() — Chromium may
  // skip programmatically-created entries, which would leave the hash dangling
  const clearHash = () => {
    if (idFromHash(location.hash)) history.replaceState(history.state, '', location.pathname + location.search);
  };

  /** Close from our own UI paths — cleanup is explicit, not left to the
   *  asynchronous `close` event. */
  const close = () => {
    if (!dialog.open) return;
    frame.replaceChildren();
    clearHash();
    dialog.close();
  };

  // native close requests (e.g. browser-level Esc handling) land here too
  dialog.addEventListener('close', () => {
    frame.replaceChildren();
    if (closingFromPopstate) {
      closingFromPopstate = false;
      return;
    }
    clearHash();
  });

  window.addEventListener('popstate', () => {
    const i = indexOfId(idFromHash(location.hash));
    if (i >= 0) {
      open(i, false);
    } else if (dialog.open) {
      closingFromPopstate = true;
      frame.replaceChildren();
      dialog.close();
    }
  });

  // open from gallery cards
  document.addEventListener('click', (e) => {
    const a = (e.target as Element).closest?.('a[data-photo]');
    if (!(a instanceof HTMLAnchorElement)) return;
    const i = indexOfId(a.dataset.photo ?? null);
    if (i < 0) return;
    e.preventDefault();
    open(i, true);
  });

  dialog.querySelector('[data-lb-close]')?.addEventListener('click', close);
  dialog.querySelector('[data-lb-prev]')?.addEventListener('click', () => show(index - 1));
  dialog.querySelector('[data-lb-next]')?.addEventListener('click', () => show(index + 1));

  // click on the empty stage (not the photo or a button) closes
  stage.addEventListener('click', (e) => {
    if (e.target === stage || e.target === frame) close();
  });

  document.addEventListener('keydown', (e) => {
    if (!dialog.open) return;
    if (e.key === 'ArrowRight') show(index + 1);
    if (e.key === 'ArrowLeft') show(index - 1);
    if (e.key === 'Escape') {
      // explicit: the native dialog close-request isn't reliable everywhere
      e.preventDefault();
      close();
    }
  });

  // horizontal swipe
  let startX = 0;
  let startY = 0;
  stage.addEventListener('pointerdown', (e) => {
    startX = e.clientX;
    startY = e.clientY;
  });
  stage.addEventListener('pointerup', (e) => {
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(e.clientY - startY)) {
      show(index + (dx < 0 ? 1 : -1));
    }
  });

  // deep link: /photos/#p:<id>
  const initial = indexOfId(idFromHash(location.hash));
  if (initial >= 0) open(initial, false);
}
