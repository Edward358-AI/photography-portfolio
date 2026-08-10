/** Blur-up fades + tap-to-toggle EXIF overlay.
 *  This is the only client-side JavaScript on the site. */

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

// Tap/click a photo to pin its EXIF overlay (the only way to see it on touch
// screens); tap it again — or anywhere else — to dismiss.
document.addEventListener('click', (e) => {
  const card = e.target instanceof Element ? e.target.closest('.card') : null;
  const shown = card?.classList.contains('show');
  for (const c of document.querySelectorAll('.card.show')) c.classList.remove('show');
  if (card && !shown) card.classList.add('show');
});
