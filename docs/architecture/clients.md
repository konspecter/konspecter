# Clients

All clients share one React UI (`apps/web`). Platform wrappers add native integration only
where a platform needs it.

## Web / PWA

The web app is an installable Progressive Web App (`vite-plugin-pwa`, Workbox, MIT).

- **Installability:** `manifest.webmanifest` (name, standalone display, theme colours, 192 px,
  512 px and maskable icons), an Apple touch icon, and a service worker.
- **Offline shell:** the service worker precaches the whole build: HTML, CSS, every
  JavaScript chunk including the lazily loaded reader, editors and CodeMirror language
  grammars, and the icons. About 2.8 MB uncompressed, downloaded in the background after the
  first visit. Navigations fall back to `index.html`, so every route opens offline.
- **Offline data:** notes, indexes, reading positions and settings live in IndexedDB. Nothing
  needs the network. After the first note is created the app asks for **persistent storage**
  (`navigator.storage.persist()`), so the browser does not evict notes under storage
  pressure. Settings → Offline storage shows the status and can ask again. Some browsers grant
  this silently, and Firefox asks the user.
- **Cache strategy:**

  | What                       | Strategy                                     | Why                                  |
  | -------------------------- | -------------------------------------------- | ------------------------------------ |
  | App build (all assets)     | precache, versioned by content hash          | exact, atomic updates; works offline |
  | Page navigations           | `index.html` from precache                   | SPA routes offline                   |
  | Images referenced by notes | stale-while-revalidate, 300 entries, 90 days | last copy offline, refreshed online  |
  | Note data                  | IndexedDB, not the HTTP cache                | local-first source of truth          |

  Old precaches are cleaned up on activation.

- **Updates:** a new service worker waits. The app shows "A new version is available" with
  _Reload_ / _Later_. It never reloads by itself, because that could interrupt an edit.
- The PWA does not pretend to be a filesystem app. Working on real `.md` folders is the
  desktop client's File Mode.

Background synchronization arrives with the sync engine (server phases).

## Desktop (Tauri)

`apps/desktop` wraps the same web build in a native window ([ADR-007](decisions/ADR-007-tauri.md)).

```text
apps/desktop/
├── package.json            scripts: dev (tauri dev), bundle (tauri build)
└── src-tauri/
    ├── tauri.conf.json     window, CSP, bundle targets (.app, .dmg), identifier
    ├── capabilities/       per-window permissions (core:default only)
    ├── src/lib.rs          native commands (app_info) and the app builder
    ├── deny.toml           Rust dependency license policy (cargo-deny)
    └── icons/              generated from apps/web/public/icon-512.png
```

- **Development:** `pnpm --filter @konspecter/desktop dev` runs the web dev server and opens
  it in the desktop window with hot reload.
- **Packaging:** `pnpm --filter @konspecter/desktop bundle` builds the web app and a release
  binary (LTO, stripped), then bundles `Konspecter.app` and a `.dmg` under
  `src-tauri/target/release/bundle/`. Signing and notarization are configured through CI secrets ([release](../release.md)).
- **Native boundary:** `apps/web/src/infrastructure/desktop/desktop.ts`. `isDesktop()` detects
  the shell, and typed wrappers call Rust commands with validated results. Today there is one
  command, `app_info`, which Settings → About shows. File Mode adds folder access and the
  file watcher here.
- **Differences from the PWA:** no service worker or update banner (the bundle contains the
  files). Settings shows _About_ instead of the storage-persistence section.
- **Requirements:** Rust (rustup) and Xcode Command Line Tools on macOS. WebKitGTK and friends
  on Linux (see the CI job).

## Mobile (Capacitor, Android)

`apps/mobile` runs the same web build in Android's web view ([ADR-008](decisions/ADR-008-capacitor.md)).

```text
apps/mobile/
├── capacitor.config.json   appId app.konspecter.mobile, webDir ../web/dist, https scheme
├── package.json            sync (build web + cap sync), android:debug, android:open
└── android/                generated Android project (Gradle; compile/target SDK 36, min 24)
```

- **Everything is shared:** UI, domain rules, IndexedDB storage, search, tags, reading
  positions, settings, and sync with conflict handling. The only mobile-specific code is
  `infrastructure/mobile/mobile.ts`, which detects the native shell to skip the service worker.
- **Sync:** the app's origin is `https://localhost`, so the server needs
  `KONSPECTER_ALLOWED_ORIGINS=https://localhost` (plus the web origin). Cleartext HTTP is not
  allowed, so use an `https://` server URL.
- **Layout:** the viewport uses `viewport-fit=cover`, and the page keeps clear of notches and
  rounded corners with `env(safe-area-inset-*)`.
- **Building:** `pnpm --filter @konspecter/mobile android:debug` produces
  `android/app/build/outputs/apk/debug/app-debug.apk`. It needs JDK 21 (`brew install
openjdk@21`) and the Android SDK (`ANDROID_HOME`). CI builds the debug APK on every push and
  uploads it as an artifact.
- **iOS** is not set up (decision pending). `npx cap add ios` would add it with the same web
  build.
