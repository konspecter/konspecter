type CoverImageProps = {
  src: string;
};

/**
 * The note's cover. Only absolute http(s) URLs are shown, matching what the
 * reader allows for images; paths are kept in the document for File Mode.
 */
export function CoverImage({ src }: CoverImageProps) {
  if (!isDisplayableCover(src)) {
    return null;
  }
  return <img className="note-cover" src={src} alt="" loading="lazy" />;
}

export function isDisplayableCover(src: string): boolean {
  try {
    const url = new URL(src);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
