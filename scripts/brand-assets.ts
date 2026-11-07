/**
 * Writes the brand's image files from the config: the SVG marks, every favicon size, and the 400 by 400
 * picture for the X profile. The share image is drawn by web/app/opengraph-image.tsx instead.
 *
 *   pnpm brand
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { APP_FAVICON_SVG, APP_LOGO_LIGHT_SVG, APP_LOGO_SVG, BRAND, logoFile } from "@rerun/shared/browser";

const PUBLIC = path.resolve(import.meta.dirname, "../web/public");
const out = (file: string) => path.join(PUBLIC, file);
mkdirSync(out("brand"), { recursive: true });

const mark = logoFile(APP_LOGO_SVG);
const favicon = logoFile(APP_FAVICON_SVG);
writeFileSync(out(BRAND.files.mark), mark);
writeFileSync(out(BRAND.files.markLight), logoFile(APP_LOGO_LIGHT_SVG));
writeFileSync(out(BRAND.files.favicon), favicon);

const png = (svg: string, size: number, density = 300) => sharp(Buffer.from(svg), { density }).resize(size, size).png();

async function main() {
  const png16 = await png(favicon, 16).toBuffer();
  const png32 = await png(favicon, 32).toBuffer();
  const png48 = await png(favicon, 48).toBuffer();
  writeFileSync(out(BRAND.files.png16), png16);
  writeFileSync(out(BRAND.files.png32), png32);
  // Apple draws its own corners, and transparent ones turn black or white, so this one is flat.
  await png(mark, 180).flatten({ background: BRAND.colors.ink }).toFile(out(BRAND.files.appleTouch));
  await png(mark, 512).toFile(out(BRAND.files.png512));
  await png(mark, 400).toFile(out(BRAND.files.xProfile));

  // A .ico is a small directory of images. Crawlers and old browsers ask for /favicon.ico by name.
  const images = [png16, png32, png48];
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach((img, i) => {
    const size = [16, 32, 48][i]!;
    const at = 6 + 16 * i;
    head.writeUInt8(size, at);
    head.writeUInt8(size, at + 1);
    head.writeUInt16LE(1, at + 4);
    head.writeUInt16LE(32, at + 6);
    head.writeUInt32LE(img.length, at + 8);
    head.writeUInt32LE(offset, at + 12);
    offset += img.length;
  });
  writeFileSync(out("favicon.ico"), Buffer.concat([head, ...images]));
  console.log(`wrote the marks, favicons and X picture to ${PUBLIC}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
