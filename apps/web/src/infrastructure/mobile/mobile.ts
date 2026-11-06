/**
 * The mobile app (Capacitor, apps/mobile) runs this same web app in a native
 * web view: storage is IndexedDB and sync uses fetch, exactly as in the
 * browser. Only the system's back button needs the native side, through
 * Capacitor's App plugin, loaded only in the mobile app.
 */
export function isNativeMobile(): boolean {
  const capacitor = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return capacitor?.isNativePlatform?.() === true;
}

/**
 * Takes over Android's back button: `handle` does what back does in the app
 * and says whether it did anything. When it did not (nothing is left to go
 * back to), the app goes to the background, as Android's own back does on
 * an app's first screen. Without a listener, back would close the app from
 * any page. Returns a function that gives the button back.
 */
export type BackButton = (handle: () => boolean) => () => void;

export const nativeBackButton: BackButton = (handle) => {
  let given = false;
  let remove: (() => Promise<void>) | null = null;
  void import("@capacitor/app")
    .then(async ({ App }) => {
      const listener = await App.addListener("backButton", () => {
        if (!handle()) void App.minimizeApp();
      });
      remove = () => listener.remove();
      if (given) await remove();
    })
    .catch((error: unknown) => {
      console.error("The back button could not be taken over:", error);
    });
  return () => {
    given = true;
    void remove?.();
  };
};
