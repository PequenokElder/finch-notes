// Notes reference images by relative path (attachments/x.png). Resolve them to file:// URLs for display.
let base = '';
export function setImageBase(notesDir) {
  base = 'file://' + notesDir.split('/').map(encodeURIComponent).join('/') + '/';
}
export function resolveImageSrc(href) {
  if (!href || /^(https?:|file:|data:|\/)/i.test(href)) return href;
  return base + href.split('/').map(encodeURIComponent).join('/');
}
