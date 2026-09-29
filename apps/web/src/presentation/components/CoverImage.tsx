import { currentLocale, t } from "../i18n/i18n";

type CoverImageProps = {
  src: string;
};

/**
 * The note's cover. Absolute http(s) URLs and uploaded images (base64 `data:`
 * URLs of raster types) are shown; paths are kept in the document for File Mode.
 */
export function CoverImage({ src }: CoverImageProps) {
  if (!isDisplayableCover(src)) {
    return null;
  }
  return <img className="note-cover" src={src} alt="" loading="lazy" />;
}

const EMBEDDED_COVER = /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[A-Za-z0-9+/]+={0,2}$/;

export function isDisplayableCover(src: string): boolean {
  if (isEmbeddedCover(src)) return true;
  try {
    const url = new URL(src);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** An uploaded cover: the image itself, as a base64 `data:` URL. */
export function isEmbeddedCover(src: string): boolean {
  return EMBEDDED_COVER.test(src);
}

/** Decoded size of an uploaded cover, in bytes. */
export function embeddedCoverBytes(src: string): number {
  const base64 = src.slice(src.indexOf(",") + 1);
  return Math.floor((base64.length * 3) / 4) - (base64.match(/=+$/)?.[0].length ?? 0);
}

/** "Uploaded image, 180 kB": how an uploaded cover is shown instead of its text. */
export function uploadedCoverLabel(src: string): string {
  const size = new Intl.NumberFormat(currentLocale(), {
    style: "unit",
    unit: "kilobyte",
    maximumFractionDigits: 0,
  }).format(Math.max(1, embeddedCoverBytes(src) / 1000));
  return t("editor.coverUploaded", { size });
}
