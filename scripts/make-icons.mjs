import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import png2icons from 'png2icons';
import pngToIco from 'png-to-ico';
import sharp from 'sharp';

// Rasterize the V13 Tally Five logo (four ink verticals + terracotta diagonal)
// into every icon size we ship. Bar widths and stroke weight scale with the
// output size so strokes stay legible from 16 px tray icons up to 1024 px.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const iconset = path.join(root, 'assets', 'icon.iconset');
const outIco = path.join(root, 'assets', 'icon.ico');
const outIcns = path.join(root, 'assets', 'icon.icns');
const outLinuxPng = path.join(root, 'assets', 'icon.png');
const outTrayPng = path.join(root, 'assets', 'tray.png');
const outTrayIco = path.join(root, 'assets', 'tray.ico');

const INK = '#141413';
const TERRACOTTA = '#c96442';

// Per-size geometry: at 16 px the strokes need to be proportionally thick
// to survive rasterisation, so we up-weight them. At 128+ we use the
// editorial proportions from the design board.
function svgFor(pixelSize) {
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
  } else if (pixelSize <= 48) {
    barW = 8;
    gap = 11;
    strokeT = 9;
    barH = 82;
  } else if (pixelSize <= 128) {
    barW = 6;
    gap = 12;
    strokeT = 8;
    barH = 82;
  } else {
    barW = 5;
    gap = 13;
    strokeT = 7;
    barH = 80;
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

  // Diagonal extends slightly past the outer bars on both sides so the
  // "five-mark" cross is clearly legible.
  const x1 = startX - barW * 0.6;
  const y1 = barY + barH - barH * 0.05;
  const x2 = startX + totalW + barW * 0.6;
  const y2 = barY + barH * 0.05;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  ${bars}
  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
        stroke="${TERRACOTTA}" stroke-width="${strokeT}" stroke-linecap="round"/>
</svg>`;
}

async function renderPng(pixelSize) {
  const svg = svgFor(pixelSize);
  return sharp(Buffer.from(svg), { density: 384 })
    .resize(pixelSize, pixelSize)
    .png()
    .toBuffer();
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function main() {
  await ensureDir(iconset);

  const iconsetSizes = [
    ['icon_16x16.png', 16],
    ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32],
    ['icon_32x32@2x.png', 64],
    ['icon_64x64.png', 64],
    ['icon_128x128.png', 128],
    ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256],
    ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512],
    ['icon_512x512@2x.png', 1024],
    ['icon_1024x1024.png', 1024],
  ];

  for (const [name, size] of iconsetSizes) {
    const buf = await renderPng(size);
    await fs.writeFile(path.join(iconset, name), buf);
    console.log(`Wrote ${name} (${size}×${size}, ${buf.length} bytes)`);
  }

  const icoSources = [
    path.join(iconset, 'icon_16x16.png'),
    path.join(iconset, 'icon_32x32.png'),
    path.join(iconset, 'icon_32x32@2x.png'),
    path.join(iconset, 'icon_128x128.png'),
    path.join(iconset, 'icon_256x256.png'),
  ];
  const icoBuf = await pngToIco(icoSources);
  await fs.writeFile(outIco, icoBuf);
  console.log(`Wrote ${outIco} (${icoBuf.length} bytes)`);

  const trayIcoBuf = await pngToIco([
    path.join(iconset, 'icon_16x16.png'),
    path.join(iconset, 'icon_32x32.png'),
  ]);
  await fs.writeFile(outTrayIco, trayIcoBuf);
  console.log(`Wrote ${outTrayIco} (${trayIcoBuf.length} bytes)`);

  const trayPngBuf = await fs.readFile(path.join(iconset, 'icon_32x32.png'));
  await fs.writeFile(outTrayPng, trayPngBuf);
  console.log(`Wrote ${outTrayPng}`);

  // macOS .icns — derived from the 1024×1024 master PNG. png2icons bakes
  // in every size Finder / Dock needs. Pure JS, no native toolchain, so
  // this runs the same on Windows / Linux CI as it would on macOS.
  const masterPng = await fs.readFile(path.join(iconset, 'icon_1024x1024.png'));
  const icnsBuf = png2icons.createICNS(masterPng, png2icons.BILINEAR, 0);
  if (!icnsBuf) throw new Error('png2icons.createICNS returned null');
  await fs.writeFile(outIcns, icnsBuf);
  console.log(`Wrote ${outIcns} (${icnsBuf.length} bytes)`);

  // Linux AppImage icon — electron-builder expands a single high-res PNG
  // into the required freedesktop hicolor sizes at packaging time.
  await fs.writeFile(outLinuxPng, masterPng);
  console.log(`Wrote ${outLinuxPng} (${masterPng.length} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
