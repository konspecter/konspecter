# ADR-008: Capacitor for the mobile app

Status: accepted (2026-09-28)

## Context

The mobile client must share the web UI and its domain and application logic, work
offline with local storage, and sync. File Mode is not required on mobile.

## Decision

Capacitor 8. `apps/mobile` is a Capacitor project whose web assets are the web build
(`apps/web/dist`), shown in the platform's web view with the origin `https://localhost`.
Android is set up. iOS is left out for now (a decision for later). Everything runs unchanged:
IndexedDB storage, the sync engine over `fetch`, and the reader and editors. The web app only
detects the native shell (`infrastructure/mobile/`) to skip the service worker, since the
files ship inside the app.

## Consequences

- One codebase. The mobile app gets every feature the web app has, including offline sync
  and conflict handling.
- The sync server must allow the origin `https://localhost` (`KONSPECTER_ALLOWED_ORIGINS`).
- Native capabilities, when needed, come from Capacitor plugins behind a boundary like the
  desktop bridge.
- Android builds need JDK 21 and the Android SDK. CI builds a debug APK on every push.

## Alternatives considered

- **React Native**: a native UI, but a second UI codebase, and our editors (ProseMirror,
  CodeMirror) are DOM-based.
- **Tauri mobile**: would share the desktop shell, but its mobile support and plugin set are
  younger than Capacitor's, and mobile does not need the Rust file access.
- **PWA only**: already available, but it has no app-store presence, and iOS limits storage
  and background behaviour.
