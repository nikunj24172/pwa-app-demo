/**
 * Rasterize the SVG app icons into the PNG set Chrome/Safari require for PWA
 * installability (SVG-only manifests never fire `beforeinstallprompt`).
 * Run: node scripts/gen-icons.mjs
 */
import sharp from "sharp";

const jobs = [
  { src: "public/icon.svg", out: "public/icon-192.png", size: 192 },
  { src: "public/icon.svg", out: "public/icon-512.png", size: 512 },
  { src: "public/icon-maskable.svg", out: "public/icon-maskable-512.png", size: 512 },
  // iOS home-screen icon (Safari ignores SVG): opaque, no rounded corners —
  // iOS applies its own mask.
  { src: "public/icon.svg", out: "public/apple-touch-icon.png", size: 180, flatten: true },
];

for (const j of jobs) {
  let img = sharp(j.src, { density: 300 }).resize(j.size, j.size);
  if (j.flatten) img = img.flatten({ background: "#0b1220" });
  await img.png().toFile(j.out);
  console.log(`✓ ${j.out} (${j.size}x${j.size})`);
}
