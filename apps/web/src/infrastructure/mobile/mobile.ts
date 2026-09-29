/**
 * The mobile app (Capacitor, apps/mobile) runs this same web app in a native
 * web view. It needs no bridge of its own yet: storage is IndexedDB and sync
 * uses fetch, exactly as in the browser.
 */
export function isNativeMobile(): boolean {
  const capacitor = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return capacitor?.isNativePlatform?.() === true;
}
