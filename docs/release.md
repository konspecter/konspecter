# Releasing

1. Pick the version by [semantic versioning](https://semver.org): a patch (`0.1.1`) for fixes,
   a minor (`0.2.0`) for features, a major for breaking changes (before 1.0, a minor may
   break too: the sync API, the stored notes, the deploy's settings). `pnpm version:set 0.2.0`
   writes it everywhere: `package.json`, `apps/*/package.json`,
   `apps/desktop/src-tauri/tauri.conf.json`, `Cargo.toml` and `Cargo.lock`, the Android
   `versionName` and `versionCode`, and `KONSPECTER_VERSION` in `deploy/.env.example`.
   `pnpm versions:check` verifies it (CI runs it on every push, and the release against its
   tag). The Android `versionCode` is `major * 10000 + minor * 100 + patch`, so minor and
   patch stay below 100; a pre-release (`0.2.0-rc.1`) shares its release's code.
2. Turn `## Unreleased` in `CHANGELOG.md` into the version's heading, commit, then tag and
   push: `git tag -a v0.2.0 -m "Konspecter 0.2.0" && git push --atomic origin main v0.2.0`.
   A pre-release tag (`v0.2.0-rc.1`) builds the same, but does not move the images' `X.Y` and
   `latest`. `pnpm release` does steps 1 and 2 (`pnpm release minor` or `pnpm release 0.3.0`
   to choose the version, `--dry-run` to only show it and the notes), and so does the `release`
   skill in Claude Code (`/release`, `/release minor`): it works out the bump from the
   Conventional Commits since the last tag (a breaking change is major, a minor before 1.0; a
   `feat` minor; anything else patch), asks before changing anything, then commits, tags and
   pushes.
3. `.github/workflows/release.yml` builds everything into a **draft** GitHub Release. Its
   notes are the version's section of `CHANGELOG.md` (`scripts/release-notes.mjs`; a
   pre-release without a section of its own takes the Unreleased ones). With no section, the
   release stops at its first job.

   | Artifact                                                                           | Built by                               |
   | ---------------------------------------------------------------------------------- | -------------------------------------- |
   | `konspecter-web-vX.zip` (static PWA, host behind HTTPS)                            | `pnpm --filter @konspecter/web build`  |
   | `konspecter-site-vX.tar.gz` (account site: SSR build and its dependencies)         | `pnpm --filter @konspecter/site build` |
   | `konspecter-server-vX-<os>-<arch>.tar.gz` (Linux, macOS, Windows)                  | `go build` with the version stamped in |
   | desktop `.dmg` (Apple Silicon and Intel), `.msi`/`.exe`, `.AppImage`/`.deb`/`.rpm` | `tauri-action`                         |
   | `konspecter-vX-debug.apk`                                                          | Gradle (debug build)                   |
   | `konspecter-deploy-vX.tar.gz` (`compose.yaml`, `Caddyfile`, `.env.example`)        | `deploy/`, registry and version set    |
   | `Konspecter-{macos-arm64,macos-x64}.dmg`, `Konspecter-windows-x64-setup.exe`,      | `publish`: copies of the downloads     |
   | `Konspecter-linux-x64.AppImage`, `Konspecter-android.apk` (no version in the name) |                                        |

   The copies without a version are what a site links to: `releases/latest/download/<name>`
   always serves the newest release's (`KONSPECTER_DOWNLOAD_*_URL`). A pre-release is never
   the latest, so it never reaches those links.

   It also pushes the images `ghcr.io/<owner>/konspecter-{server,site,web}:X.Y.Z` for
   `linux/amd64` and `linux/arm64` ([ADR-023](architecture/decisions/ADR-023-published-images.md)).

4. Once every build has passed, the release publishes itself (a pre-release tag as a
   pre-release), and points the images' `X.Y` and `latest` tags at `X.Y.Z`
   (`images-latest.yml`; not for a pre-release). A failed build leaves the draft: run the
   failed jobs again, or fix and publish it by hand, which moves `X.Y` and `latest` too.
5. **Deploying it** (optional). With the repository variable `DEPLOY_REPOSITORY` (an
   `owner/name`) and the secret `DEPLOY_TOKEN` (a fine-grained token that may write that
   repository's contents), a published release, not a pre-release, ends with a
   `repository_dispatch` there: the event `konspecter-release`, with `{"version": "X.Y.Z"}`.
   Its images and deploy bundle can be downloaded by then, so a workflow there can deploy
   it. Without both, the release stops at publishing.

The first release creates the three GHCR packages **private**. Make each public once
(the package's settings → Change visibility) and link it to the repository, so anyone can
pull it.

## GitLab

`.gitlab-ci.yml` runs the same pipelines on GitLab: the checks of `ci.yml` on merge requests
and on the default branch, and the release builds of `release.yml` on a `v*` tag. GitLab has
no draft releases, so the last job, **publish**, is manual: once the build jobs have passed
(their artifacts can be downloaded from the pipeline), running it uploads every artifact to
the project's generic package registry (`konspecter/<version>`) and creates the GitLab
Release that links them, with the same notes from `CHANGELOG.md`. The images go to the project's container registry
(`$CI_REGISTRY_IMAGE/konspecter-{server,site,web}`, which must be enabled) from
`release-images`, built with Docker in Docker (the runner must allow privileged
containers); `publish-images` moves `X.Y` and `latest` once **publish** has run.

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
repository root). The web app image, its static files served on `:8080`, suggesting the
server in `KONSPECTER_PUBLIC_URL` when it runs: `docker build -f apps/web/Dockerfile -t
konspecter-web .`. The whole stack, with PostgreSQL and Caddy serving the site and API on
one origin and the web app on another, is `deploy/compose.yaml`
([self-hosting.md](self-hosting.md)).

The site tarball runs on Node 22 or later, behind the same origin as the API:

```sh
tar -xzf konspecter-site-v0.1.0.tar.gz && cd konspecter-site-v0.1.0
KONSPECTER_API_URL=http://127.0.0.1:8080 KONSPECTER_PUBLIC_URL=https://konspecter.com \
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

| Platform                   | Secrets                                                                                                                    | Notes                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| macOS (Developer ID)       | `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | signs and notarizes: Gatekeeper opens the app without a warning                   |
| macOS (self-signed)        | `MACOS_CERTIFICATE`, `MACOS_CERTIFICATE_PASSWORD`                                                                          | until there is a Developer ID; see below. Ignored once `APPLE_CERTIFICATE` is set |
| Windows                    | code-signing certificate (`tauri.conf.json` `bundle.windows`)                                                              | unsigned builds trigger SmartScreen                                               |
| Android                    | a keystore (`KEYSTORE_BASE64`, passwords) for `assembleRelease`                                                            | the workflows ship a debug APK until one exists                                   |
| Desktop updates (optional) | `TAURI_SIGNING_PRIVATE_KEY`                                                                                                | only if the Tauri updater is enabled                                              |

The app identifiers (`app.konspecter.desktop`, `app.konspecter.mobile`) are placeholders.
Change them to a domain you control before the first public release. They cannot change
afterwards without losing app data.

### macOS without a Developer ID

Without either certificate the app is ad-hoc signed, and macOS takes every build for a
different app. The keychain then asks for the login password again after each update: the
encryption key WebKit keeps for the app ("Konspecter WebCrypto Master Key") and the sync
token are trusted to the build that saved them, and "Always Allow" lasts only until the next
one.

A self-signed certificate fixes that. The keychain trusts its designated requirement,
`identifier "app.konspecter.desktop" and certificate leaf = H"…"`, so one "Always Allow"
carries over every later release signed with the same certificate. It does not satisfy
Gatekeeper: people open the app once by hand (see the README's Quick start).

Make the certificate once, valid for ten years (Keychain Access gives one year, and a new
certificate means one more password prompt for everyone). With Homebrew's OpenSSL 3; drop
`-legacy` with macOS's own `openssl`:

```sh
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=Konspecter" \
  -addext "basicConstraints=critical,CA:false" -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning" -keyout konspecter.key -out konspecter.crt
openssl pkcs12 -export -legacy -inkey konspecter.key -in konspecter.crt -name Konspecter \
  -out konspecter.p12
base64 -i konspecter.p12 | pbcopy   # MACOS_CERTIFICATE; the export password is MACOS_CERTIFICATE_PASSWORD
```

Keep `konspecter.p12` and its password somewhere safe and delete the rest. The release jobs
put the certificate in a keychain of their own (`scripts/macos-signing-keychain.sh`) and sign
with it. Tauri's `APPLE_CERTIFICATE` import is not used for it: it accepts only identities
macOS trusts, which a self-signed one is not.

To sign your own builds with it, import it into the login keychain (`security import
konspecter.p12 -k ~/Library/Keychains/login.keychain-db -T /usr/bin/codesign`) and build with
`APPLE_SIGNING_IDENTITY=Konspecter pnpm --filter @konspecter/desktop bundle`. A build
signed this way and a release are the same app to the keychain.

Moving to a Developer ID later changes the signer, so the keychain asks once more.
