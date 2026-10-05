# Konspecter

A local-first knowledge base for conspects of every kind. **Every conspect is a plain Markdown
document**, and everything else (tags, search, reading positions) is derived from it and can be
rebuilt at any time. Your conspects work offline, sync in the background when you want them
to, and export as ordinary `.md` files.

## Features

- **Two editors:** a Telegraph-like text editor, and a Markdown source editor (CodeMirror) with
  frontmatter and code highlighting. Switching never changes what a conspect means.
- **Reading:** GitHub-flavored Markdown with syntax highlighting. Raw HTML is sanitized, and
  the app remembers where you stopped reading.
- **Tags anywhere in the text:** `#java` or nested `#java#collections`, with a tag tree and
  filtering.
- **Search:** fast full-text search, offline, combined with tag filters (`hashmap #java`).
- **Local-first:** conspects live on your device (IndexedDB) and the app is an installable PWA.
  Sync with a Konspecter server is optional, with conflict handling that never loses a
  version.
- **Desktop (Tauri):** work directly on a folder of `.md` files, alongside VS Code, Vim or Git.
- **Android (Capacitor):** the same app on your phone.
- **Import and export:** `.md` files and folders in, `.md` files (ZIP or folder) out.

## Using it

- **Web:** open the app and install it from the browser (it works offline after the first
  visit).
- **Desktop:** download the `.dmg`, `.msi` or `.AppImage` from a release. Settings → Library
  → _Open a Markdown folder…_ works on real files.
- **Android:** install the APK from a release.

Conspects save themselves as you type. Keyboard shortcuts (<kbd>⌘</kbd> on macOS, <kbd>Ctrl</kbd>
elsewhere): <kbd>⌘P</kbd> search, <kbd>Esc</kbd> all conspects, <kbd>⌘N</kbd> new conspect, <kbd>⌘,</kbd> settings,
<kbd>⌘S</kbd> save now; outside text fields also <kbd>/</kbd>, <kbd>n</kbd> and <kbd>?</kbd>
(all shortcuts).

### Sync server (optional)

```sh
docker build -t konspecter-server apps/server/
docker run -e KONSPECTER_DATABASE_URL=postgres://user:pass@db/konspecter \
  -e KONSPECTER_ALLOWED_ORIGINS=https://notes.example.com,https://localhost \
  -p 8080:8080 konspecter-server
docker run --rm -e KONSPECTER_DATABASE_URL=… konspecter-server create-user -email you@example.com
```

Paste the server URL and the printed token into Settings → **Sync**. Serve the API over
HTTPS in production (for example behind a reverse proxy).

## Development

Requirements: Node ≥ 22.22, pnpm 10, Go 1.27. Rust (rustup) for the desktop app. JDK 21 and
the Android SDK for Android.

```sh
pnpm install
pnpm dev                                    # web app on http://localhost:5173
pnpm check                                  # format, lint, typecheck, test, build, licenses
pnpm e2e                                    # end-to-end tests in Chromium
cd apps/server && go test ./...                  # server (see docs for the PostgreSQL tests)
pnpm --filter @konspecter/desktop dev       # desktop app
pnpm --filter @konspecter/mobile android:debug
```

### Debugging on Android

Needs JDK 21 (`brew install openjdk@21`), the Android SDK (`ANDROID_HOME`, `adb` on the
`PATH`), and a phone with USB debugging on (Settings → Developer options) or an emulator.

```sh
adb devices                                     # the phone or emulator must be listed
pnpm --filter @konspecter/mobile android:debug  # build the web app, sync it, build the debug APK
adb install -r apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n app.konspecter.mobile/.MainActivity
```

- **Inspect the web view:** open `chrome://inspect` in desktop Chrome, find Konspecter under
  the device and press _inspect_: DevTools with the console, elements and network. Debug builds
  allow it; release builds do not.
- **Logs:** `adb logcat -s Capacitor/Console` shows the app's console, including the real
  errors behind "Oops, something went wrong."
- **Android Studio:** `pnpm --filter @konspecter/mobile android:open` opens the project there,
  to run it on a device and debug the native side.
- After changing the web app, run `android:debug` and install again: the APK carries its own
  copy of the web build.

## Documentation

- [Architecture overview](docs/architecture/overview.md) and [decisions](docs/architecture/decisions/)
- [Testing](docs/testing.md) · [Performance](docs/performance.md) · [Security](docs/security.md)
- [Releasing](docs/release.md) · [License policy](docs/license-policy.md) · [Changelog](CHANGELOG.md)
- [Agent instructions](AGENTS.md) and the [implementation plan](.claude/plans/konspecter-implementation-plan.md)
