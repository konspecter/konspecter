#!/usr/bin/env bash
# Puts a self-signed code-signing certificate into a keychain of its own and prints the
# identity's name, for APPLE_SIGNING_IDENTITY (docs/release.md). Tauri's own import
# (APPLE_CERTIFICATE) accepts only identities macOS trusts, which a self-signed one is not;
# codesign signs with it all the same. For a CI machine: the keychain joins the search list.
#
#   MACOS_CERTIFICATE           the .p12, base64
#   MACOS_CERTIFICATE_PASSWORD  its password
set -euo pipefail

: "${MACOS_CERTIFICATE:?the .p12 certificate, base64}"
: "${MACOS_CERTIFICATE_PASSWORD:?the certificate password}"

dir="$(mktemp -d)"
keychain="$dir/signing.keychain-db"
password="$(openssl rand -hex 16)"

printf '%s' "$MACOS_CERTIFICATE" | base64 --decode > "$dir/certificate.p12"
security create-keychain -p "$password" "$keychain"
security set-keychain-settings "$keychain" # no auto-lock during a long build
security unlock-keychain -p "$password" "$keychain"
security import "$dir/certificate.p12" -k "$keychain" -P "$MACOS_CERTIFICATE_PASSWORD" \
  -T /usr/bin/codesign > /dev/null
rm "$dir/certificate.p12"
# Lets codesign use the key without asking.
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$password" "$keychain" \
  > /dev/null

existing=()
while IFS= read -r line; do
  line="${line#"${line%%[![:space:]]*}"}"
  existing+=("${line//\"/}")
done < <(security list-keychains -d user)
security list-keychains -d user -s "$keychain" "${existing[@]}"

# `  1) <SHA-1> "<name>" (CSSMERR_TP_NOT_TRUSTED)`: the name of the first identity.
security find-identity -p codesigning "$keychain" | awk -F'"' '/^ *1\)/ { print $2; exit }'
