"use client";

/**
 * Downscale + re-encode an image file to a compressed JPEG data URL, so base64
 * photos stored in MongoDB stay small (typically ~100–300 KB).
 */
export async function compressImage(
  file: File,
  maxDim = 1024,
  quality = 0.7
): Promise<string> {
  const src = await readAsDataURL(file);
  const img = await loadImage(src);
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height || 1));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return src; // fallback: original
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read image"));
    img.src = src;
  });
}
