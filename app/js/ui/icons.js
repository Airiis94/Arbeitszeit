// Einheitliche Strich-Symbole (SVG) für Schaltflächen – statt Emojis, die je nach Gerät anders aussehen.

const PATHS = {
  play: 'M7 5v14l11-7z',
  pause: 'M8 5v14M16 5v14',
  stop: 'M6 6h12v12H6z',
  clock: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 7.5V12l3 2',
};

/** SVG-Symbol; `fill` für ausgefüllte Formen (Start/Stopp). */
export function icon(name, { fill = false, stroke = null } = {}) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', fill ? 'currentColor' : 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', stroke || (fill ? '1.5' : '3'));
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', PATHS[name]);
  svg.appendChild(path);
  return svg;
}
