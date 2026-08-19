/** Blur-up fades + click-to-enlarge viewer.
 *  This is the only client-side JavaScript on the site. */

/* ---- blur-up: fade images in once their bytes arrive --------------------- */

const mark = (img: HTMLImageElement) => img.classList.add('ld');

document.addEventListener(
  'load',
  (e) => {
    if (e.target instanceof HTMLImageElement) mark(e.target);
  },
  true,
);

for (const img of document.querySelectorAll('img')) {
  if (img.complete && img.naturalWidth > 0) mark(img);
}

/* ---- zoom viewer: click a card to enlarge (long side capped in CSS), ----
 * with the same title/camera/settings caption pinned bottom-left. Click
 * anywhere or press Esc to close. */

const ZOOM_SIZES = 'min(1000px, 94vw)';
let dialog: HTMLDialogElement | null = null;

const ensureDialog = () => {
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.className = 'zoom';
  dialog.setAttribute('aria-label', 'Enlarged photo');
  dialog.addEventListener('click', close);
  document.body.append(dialog);
  return dialog;
};

const close = () => {
  if (!dialog?.open) return;
  dialog.close();
  dialog.replaceChildren();
};

const open = (card: Element) => {
  const gridImg = card.querySelector('img');
  if (!gridImg) return;
  const d = ensureDialog();

  const fig = document.createElement('figure');
  const ph = card.querySelector<HTMLElement>('.ph');
  if (ph) fig.style.backgroundImage = ph.style.backgroundImage; // LQIP while loading

  const pic = document.createElement('picture');
  const gridSource = card.querySelector('source');
  if (gridSource) {
    const s = document.createElement('source');
    s.type = gridSource.type;
    s.srcset = gridSource.srcset;
    s.sizes = ZOOM_SIZES;
    pic.append(s);
  }
  const img = document.createElement('img');
  img.srcset = gridImg.srcset;
  img.sizes = ZOOM_SIZES;
  img.src = gridImg.currentSrc || gridImg.src;
  img.alt = gridImg.alt;
  img.width = Number(gridImg.getAttribute('width'));
  img.height = Number(gridImg.getAttribute('height'));
  img.decoding = 'async';
  pic.append(img);
  fig.append(pic);

  // same data the hover overlay shows, pinned to the enlarged photo
  const overlay = card.querySelector('.card-overlay');
  if (overlay) {
    const cap = document.createElement('figcaption');
    cap.className = 'zoom-caption';
    for (const span of overlay.querySelectorAll('span')) {
      const s = document.createElement('span');
      s.className = span.className;
      s.textContent = span.textContent;
      cap.append(s);
    }
    fig.append(cap);
  }

  d.replaceChildren(fig);
  d.showModal();
};

document.addEventListener('click', (e) => {
  const card = e.target instanceof Element ? e.target.closest('.gallery .card') : null;
  if (card) open(card);
});

document.addEventListener('keydown', (e) => {
  if (dialog?.open && e.key === 'Escape') {
    // explicit: the native dialog close-request isn't reliable everywhere
    e.preventDefault();
    close();
    return;
  }
  if (
    !dialog?.open &&
    (e.key === 'Enter' || e.key === ' ') &&
    document.activeElement instanceof Element &&
    document.activeElement.matches('.gallery .card')
  ) {
    e.preventDefault();
    open(document.activeElement);
  }
});
