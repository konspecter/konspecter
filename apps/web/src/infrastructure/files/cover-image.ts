/**
 * Longest side of an uploaded cover, in pixels: sharp at the note's width on a
 * high-density screen, small enough to live in the frontmatter.
 */
const MAX_SIDE = 1600;
/** A small image within `MAX_SIDE` is kept byte for byte (animation, transparency). */
const KEEP_ORIGINAL_BYTES = 256 * 1024;
const KEPT_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);
const QUALITY = 0.82;

export class CoverImageError extends Error {
  override readonly name = "CoverImageError";
}

/**
 * Turns an image file chosen by the author into a base64 `data:` URL for the
 * `cover` field, so the cover travels with the document (sync, File Mode,
 * export). Larger images are scaled down and re-encoded as WebP, or JPEG where
 * the browser cannot encode WebP.
 */
export async function coverDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new CoverImageError(`${file.name} is not an image`);
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new CoverImageError(`${file.name} could not be read as an image`);
  }
  try {
    const { width, height } = bitmap;
    const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
    if (scale === 1 && file.size <= KEEP_ORIGINAL_BYTES && KEPT_TYPES.has(file.type)) {
      return await readAsDataUrl(file);
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new CoverImageError("Images cannot be processed here");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let blob = await toBlob(canvas, "image/webp");
    if (blob.type !== "image/webp") {
      // JPEG has no transparency: put the image on white.
      context.globalCompositeOperation = "destination-over";
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      blob = await toBlob(canvas, "image/jpeg");
    }
    return await readAsDataUrl(blob);
  } finally {
    bitmap.close();
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new CoverImageError("The image could not be encoded"));
      },
      type,
      QUALITY,
    );
  });
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(reader.result as string);
    };
    reader.onerror = () => {
      reject(new CoverImageError("The image could not be read"));
    };
    reader.readAsDataURL(blob);
  });
}
