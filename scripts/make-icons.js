// Erzeugt die PNG-Icons aus app/icons/icon.svg mit Chromium (Playwright). Nur bei Icon-Änderungen nötig.
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';

const svg = await readFile(new URL('../app/icons/icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
async function render(size, file, padding = 0) {
  await page.setViewportSize({ width: size, height: size });
  const inner = size - 2 * padding;
  await page.setContent(`<html><body style="margin:0;background:${padding ? '#1f5f8b' : 'transparent'}">
    <div style="padding:${padding}px;width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`);
  await page.screenshot({ path: new URL(`../app/icons/${file}`, import.meta.url).pathname, omitBackground: !padding });
}
await render(192, 'icon-192.png');
await render(512, 'icon-512.png');
await render(512, 'icon-maskable-512.png', 56);
await browser.close();
console.log('Icons erzeugt.');
