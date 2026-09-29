# ADR-007: Tauri for the desktop app

Status: accepted (2026-09-28)

## Context

The desktop app must share the web UI, add native capabilities (a real Markdown folder, a
file watcher, opening files in an external editor), and stay small and secure.

## Decision

Tauri 2. The desktop app (`apps/desktop`) is a thin Rust shell around the web build
(`apps/web/dist`). It uses the operating system's web view (WKWebView on macOS, WebView2 on
Windows, WebKitGTK on Linux). Native features are Rust commands behind one TypeScript
boundary, `apps/web/src/infrastructure/desktop/`. That boundary is the only code that knows
about Tauri, and it loads the Tauri API only when running on the desktop.

Security defaults: a strict Content-Security-Policy (scripts only from the app, no framing,
no plugins), and capabilities that grant the window only `core:default`. Each native feature
adds exactly the permissions it needs.

## Consequences

- One UI codebase. The desktop app is a few hundred kilobytes of Rust plus the web build. It
  is a small download and uses little memory compared with Electron.
- Rust joins the toolchain (`cargo`, `clippy`, `cargo-deny` for licenses).
- Web-view differences between platforms need testing. There is no bundled browser.
- The desktop app does not register the service worker: its files ship inside the bundle.
  Notes live in the web view's IndexedDB for the app. File Mode adds a separate
  filesystem backend.

## Alternatives considered

- **Electron**: mature and consistent (bundled Chromium), but about 100 MB per app, higher
  memory use, and a Node runtime with a larger attack surface.
- **Native per platform (Swift, WinUI, GTK)**: best integration, but three UIs to build and
  maintain, which contradicts the shared-UI goal.
