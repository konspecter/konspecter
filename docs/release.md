# Releasing

1. Set the same version everywhere: `package.json`, `apps/*/package.json`,
   `apps/desktop/src-tauri/tauri.conf.json` and `Cargo.toml`.
   `pnpm versions:check` verifies it.
2. Update `CHANGELOG.md`, commit, then tag and push: `git tag v0.1.0 && git push --tags`.
3. `.github/workflows/release.yml` builds everything into a **draft** GitHub Release:

   | Artifact                                                                    | Built by                               |
   | --------------------------------------------------------------------------- | -------------------------------------- |
   | `konspecter-web-vX.zip` (static PWA, host behind HTTPS)                     | `pnpm --filter @konspecter/web build`  |
   | `konspecter-site-vX.tar.gz` (account site: SSR build and its dependencies)  | `pnpm --filter @konspecter/site build` |
   | `konspecter-server-vX-<os>-<arch>.tar.gz` (Linux, macOS, Windows)           | `go build` with the version stamped in |
   | desktop `.dmg` (Apple Silicon and Intel), `.msi`/`.exe`, `.AppImage`/`.deb` | `tauri-action`                         |
   | `konspecter-vX-debug.apk`                                                   | Gradle (debug build)                   |

4. Check the draft, then publish it.

## GitLab

`.gitlab-ci.yml` runs the same pipelines on GitLab: the checks of `ci.yml` on merge requests
and on the default branch, and the release builds of `release.yml` on a `v*` tag. GitLab has
no draft releases, so the last job, **publish**, is manual: once the build jobs have passed
(their artifacts can be downloaded from the pipeline), running it uploads every artifact to
the project's generic package registry (`konspecter/<version>`) and creates the GitLab
Release that links them.

- The desktop builds for macOS and Windows run on GitLab's hosted runners
  (`saas-macos-medium-m1`, `saas-windows-medium-amd64`; macOS needs a Premium or Ultimate
  plan) or on your own runners with those tags. Set the CI/CD variable
  `KONSPECTER_SKIP_MACOS` or `KONSPECTER_SKIP_WINDOWS` to `true` to leave one out; the
  release then has the other artifacts.
- The Linux desktop bundles (`.deb`, `.AppImage`) and everything else build in containers.
- Signing secrets go into the project's CI/CD variables under the same names as below
  (masked and protected, for protected tags).

The server image: `docker build --build-arg VERSION=0.1.0 -t konspecter-server apps/server/`.
The site image: `docker build -f apps/site/Dockerfile -t konspecter-site .` (from the
repository root). The web app image, its static files served on `:8080`: `docker build -f apps/web/Dockerfile
--build-arg VITE_KONSPECTER_SERVER_URL=https://notes.example.com -t konspecter-web .`. The whole
stack, with PostgreSQL and Caddy serving the site and API on one origin and the web app on
another, is `deploy/compose.yaml`.

The site tarball runs on Node 22 or later, behind the same origin as the API:

```sh
tar -xzf konspecter-site-v0.1.0.tar.gz && cd konspecter-site-v0.1.0
KONSPECTER_API_URL=http://127.0.0.1:8080 KONSPECTER_PUBLIC_URL=https://notes.example.com \
  node_modules/.bin/react-router-serve build/server/index.js   # PORT, default 3000
```

## Upgrading to end-to-end encryption

The release with end-to-end encrypted sync (migration `006_e2e.sql`) **deletes the notes
the server stored in plain text**. Every device keeps its own copy and uploads it again,
encrypted, once its owner has set up encryption on the site and unlocked the app with the
passphrase. So, before upgrading the server:

1. Sync every device, so no device holds a change the others have not seen.
2. Upgrade the server and the apps together: the notes API now sends `content` (an
   encrypted envelope) instead of `markdown`, and older apps cannot sync with it.
3. Set up encryption on the site's settings page, then unlock each app.

## Signing (secrets to add before a public release)

| Platform                   | Secrets                                                                                                                    | Notes                                                                                                                               |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| macOS                      | `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | picked up by `tauri-action` for signing and notarization. Unsigned builds are ad-hoc signed and blocked by Gatekeeper on other Macs |
| Windows                    | code-signing certificate (`tauri.conf.json` `bundle.windows`)                                                              | unsigned builds trigger SmartScreen                                                                                                 |
| Android                    | a keystore (`KEYSTORE_BASE64`, passwords) for `assembleRelease`                                                            | the workflows ship a debug APK until one exists                                                                                     |
| Desktop updates (optional) | `TAURI_SIGNING_PRIVATE_KEY`                                                                                                | only if the Tauri updater is enabled                                                                                                |

The app identifiers (`app.konspecter.desktop`, `app.konspecter.mobile`) are placeholders.
Change them to a domain you control before the first public release. They cannot change
afterwards without losing app data.
