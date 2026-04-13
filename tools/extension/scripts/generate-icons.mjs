import sharp from 'sharp';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Source: media/app_logo.png at the repo root
// scripts/ → tools/extension/scripts, so ../../../media points to the repo root's media/
const SRC = join(__dirname, '..', '..', '..', 'media', 'app_logo.png');
const OUT_DIR = join(__dirname, '..', 'icons');

if (!existsSync(SRC)) {
  console.error(`Source logo not found at ${SRC}`);
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });

const sizes = [16, 32, 48, 128];
for (const size of sizes) {
  const outPath = join(OUT_DIR, `icon-${size}.png`);
  await sharp(SRC).resize(size, size).png().toFile(outPath);
  console.log(`generated ${outPath}`);
}
