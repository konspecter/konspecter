/**
 * iOS Safari zooms in when a field whose text is smaller than 16px takes the
 * focus, and stays zoomed when it lets go: the page then scrolls both ways.
 * Fields here are smaller (the editor's text, the search, the forms), so on
 * iOS the viewport says `maximum-scale=1`, which stops that zoom. Safari
 * ignores the limit for the user's own pinch, so zooming still works there;
 * elsewhere the limit would stop it, so nothing else gets it.
 */

/** iPhone, iPod and iPad (which also says "Macintosh", but a Mac has no touch screen). */
export function isIos(userAgent: string, maxTouchPoints: number): boolean {
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

/** The viewport's `content` with `maximum-scale=1`, unless it limits the scale already. */
export function withoutFocusZoom(content: string): string {
  return /maximum-scale/.test(content) ? content : `${content}, maximum-scale=1`;
}

/** On iOS, stops the page zooming in when a field takes the focus. */
export function stopFocusZoom(): void {
  if (!isIos(navigator.userAgent, navigator.maxTouchPoints)) return;
  const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (viewport) viewport.content = withoutFocusZoom(viewport.content);
}
