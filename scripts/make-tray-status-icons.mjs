import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pngToIco from 'png-to-ico';
import sharp from 'sharp';

// Status-colored tray icons. Same "Tally Five" mark as the main icon (four ink
// verticals + a diagonal), but the diagonal is tinted by usage status so the
// Windows/Linux tray conveys safe/warning/critical at a glance — the tray there
// can't show colored text the way the macOS menu bar can.
//
// Run after make-icons.mjs (or anytime): `npm run make-tray-icons`.
// main.ts loads assets/tray-<status>.{ico,png} when present and falls back to
// the plain tray icon otherwise, so shipping these is optional.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const assets = path.join(root, 'assets');

const INK = '#141413';

// Tones mirror the renderer's status palette (see CodexCard.tone / thresholds).
const STATUS_COLORS = {
  safe: '#7a9b5f', // olive green
  warning: '#c96442', // terracotta
  critical: '#b53333', // red
};

// Geometry copied from make-icons.mjs svgFor so the mark matches the shipped
// icon exactly; only the diagonal color changes.
function svgFor(pixelSize, accent) {
  let barW;
  let gap;
  let strokeT;
  let barH;
  if (pixelSize <= 16) {
    barW = 14;
    gap = 8;
    strokeT = 14;
    barH = 86;
  } else if (pixelSize <= 32) {
    barW = 10;
    gap = 10;
    strokeT = 10;
    barH = 84;
  } else {
    barW = 8;
    gap = 11;
    strokeT = 9;
    barH = 82;
  }

  const totalW = 4 * barW + 3 * gap;
  const startX = (128 - totalW) / 2;
  const barY = (128 - barH) / 2;

  const bars = [0, 1, 2, 3]
    .map((i) => {
      const x = startX + i * (barW + gap);
      return `<rect x="${x}" y="${barY}" width="${barW}" height="${barH}" fill="${INK}"/>`;
    })
    .join('\n  ');

  const x1 = startX - barW * 0.6;
  const y1 = barY + barH - barH * 0.05;
  const x2 = startX + totalW + barW * 0.6;
  const y2 = barY + barH * 0.05;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  ${bars}
  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
        stroke="${accent}" stroke-width="${strokeT}" stroke-linecap="round"/>
</svg>`;
}

async function renderPng(pixelSize, accent) {
  const svg = svgFor(pixelSize, accent);
  return sharp(Buffer.from(svg), { density: 384 }).resize(pixelSize, pixelSize).png().toBuffer();
}

async function main() {
  for (const [status, accent] of Object.entries(STATUS_COLORS)) {
    const png16 = await renderPng(16, accent);
    const png32 = await renderPng(32, accent);

    const pngOut = path.join(assets, `tray-${status}.png`);
    await fs.writeFile(pngOut, png32);
    console.log(`Wrote ${pngOut} (${png32.length} bytes)`);

    const icoBuf = await pngToIco([png16, png32]);
    const icoOut = path.join(assets, `tray-${status}.ico`);
    await fs.writeFile(icoOut, icoBuf);
    console.log(`Wrote ${icoOut} (${icoBuf.length} bytes)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
