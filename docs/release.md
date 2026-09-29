# Releasing

1. Set the same version everywhere: `package.json`, `apps/*/package.json`,
   `apps/desktop/src-tauri/tauri.conf.json` and `Cargo.toml`.
   `pnpm versions:check` verifies it.
2. Update `CHANGELOG.md`, commit, then tag and push: `git tag v0.1.0 && git push --tags`.
3. `.github/workflows/release.yml` builds everything into a **draft** GitHub Release:

   | Artifact                                                                    | Built by                               |
   | --------------------------------------------------------------------------- | -------------------------------------- |
   | `konspecter-web-vX.zip` (static PWA, host behind HTTPS)                     | `pnpm --filter @konspecter/web build`  |
   | `konspecter-server-vX-<os>-<arch>.tar.gz` (Linux, macOS, Windows)           | `go build` with the version stamped in |
   | desktop `.dmg` (Apple Silicon and Intel), `.msi`/`.exe`, `.AppImage`/`.deb` | `tauri-action`                         |
   | `konspecter-vX-debug.apk`                                                   | Gradle (debug build)                   |

4. Check the draft, then publish it.

The server image: `docker build --build-arg VERSION=0.1.0 -t konspecter-server server/`.

## Signing (secrets to add before a public release)

| Platform                   | Secrets                                                                                                                    | Notes                                                                                                                               |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| macOS                      | `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | picked up by `tauri-action` for signing and notarization. Unsigned builds are ad-hoc signed and blocked by Gatekeeper on other Macs |
| Windows                    | code-signing certificate (`tauri.conf.json` `bundle.windows`)                                                              | unsigned builds trigger SmartScreen                                                                                                 |
| Android                    | a keystore (`KEYSTORE_BASE64`, passwords) for `assembleRelease`                                                            | the workflow ships a debug APK until one exists                                                                                     |
| Desktop updates (optional) | `TAURI_SIGNING_PRIVATE_KEY`                                                                                                | only if the Tauri updater is enabled                                                                                                |

The app identifiers (`app.konspecter.desktop`, `app.konspecter.mobile`) are placeholders.
Change them to a domain you control before the first public release. They cannot change
afterwards without losing app data.
