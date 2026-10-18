// Generates the PWA icons in public/icons from scripts/icon.svg.
import sharp from "sharp";
import { readFileSync } from "node:fs";

const svg = readFileSync(new URL("./icon.svg", import.meta.url));
const out = new URL("../public/icons/", import.meta.url).pathname;

for (const size of [192, 512]) {
  await sharp(svg).resize(size, size).png().toFile(`${out}icon-${size}.png`);
}
// Maskable icon: full-bleed background, logo inside the safe zone.
const maskable = Buffer.from(
  svg.toString().replace('rx="112"', 'rx="0"').replace("<path", '<g transform="translate(51 51) scale(0.8)"><path').replace("</svg>", "</g></svg>")
);
await sharp(maskable).resize(512, 512).png().toFile(`${out}maskable-512.png`);
await sharp(svg).resize(180, 180).png().toFile(`${out}apple-touch-icon.png`);
