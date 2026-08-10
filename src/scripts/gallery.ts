/** Blur-up: fade gallery images in over their LQIP once the bytes arrive.
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
