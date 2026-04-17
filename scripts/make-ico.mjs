import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pngToIco from 'png-to-ico';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const iconset = path.join(root, 'assets', 'icon.iconset');
const outIco = path.join(root, 'assets', 'icon.ico');
const outTrayPng = path.join(root, 'assets', 'tray.png');
const outTrayIco = path.join(root, 'assets', 'tray.ico');

const sources = [
  'icon_16x16.png',
  'icon_32x32.png',
  'icon_32x32@2x.png',
  'icon_128x128.png',
  'icon_256x256.png',
].map((f) => path.join(iconset, f));

const buf = await pngToIco(sources);
await fs.writeFile(outIco, buf);
console.log(`Wrote ${outIco} (${buf.length} bytes)`);

const trayPngBuf = await fs.readFile(path.join(iconset, 'icon_32x32.png'));
await fs.writeFile(outTrayPng, trayPngBuf);
console.log(`Wrote ${outTrayPng}`);

const trayIcoBuf = await pngToIco([
  path.join(iconset, 'icon_16x16.png'),
  path.join(iconset, 'icon_32x32.png'),
]);
await fs.writeFile(outTrayIco, trayIcoBuf);
console.log(`Wrote ${outTrayIco} (${trayIcoBuf.length} bytes)`);
