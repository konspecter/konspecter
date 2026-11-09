#!/usr/bin/env bash
# Every check of .github/workflows/ci.yml, run on this machine: the web, server, desktop,
# Android, end-to-end and image jobs, plus a stress run of the unit tests (four copies of
# the web and site suites at once, which shows timing races a single run hides).
#
#   pnpm check:all        by hand
#   .githooks/pre-push    before every push (installed by pnpm install)
#
# Jobs run side by side: the JavaScript chain (desktop → web → e2e → Android, one after
# the other because each builds or reads apps/web/dist), the server and the images. Each
# job's output goes to its own log; a failed job's log is printed at the end. Exits 1 when
# any check fails. Needs Node and pnpm, Go, rustup with cargo-deny, Docker (PostgreSQL in
# throwaway containers, the images), JDK 21 and the Android SDK (ANDROID_HOME).
set -u

root="$(git rev-parse --show-toplevel)" || exit 1
cd "$root" || exit 1

# Git clients and hooks do not always start from a login shell.
for dir in /opt/homebrew/opt/rustup/bin "$HOME/.cargo/bin" /opt/homebrew/bin /usr/local/bin; do
  [ -d "$dir" ] && PATH="$PATH:$dir"
done
export PATH

logs="$(mktemp -d "${TMPDIR:-/tmp}/konspecter-checks.XXXXXX")"
run_id="konspecter-check-$$"
# The end-to-end job's server and the site: fixed ports (the site's and the preview's
# are fixed in their configs).
e2e_server_addr=127.0.0.1:18080
e2e_site_port=5174
e2e_preview_port=4174

# --- Helpers --------------------------------------------------------------------------------

# kill_tree PID: the process and everything it started.
kill_tree() {
  local child
  for child in $(pgrep -P "$1" 2>/dev/null); do
    kill_tree "$child"
  done
  kill "$1" 2>/dev/null
}

cleanup() {
  local pid
  for pid in $(jobs -p); do
    kill_tree "$pid"
  done
  docker ps -aq --filter "name=$run_id" 2>/dev/null | xargs docker rm -f >/dev/null 2>&1
}

trap 'echo; echo "Interrupted."; cleanup; exit 130' INT TERM

# run COMMAND…: one step of a job; a failure marks the job failed and the job goes on, so a
# single run reports every failing step.
run() {
  echo
  echo "▶ $*"
  if "$@"; then
    return 0
  fi
  echo "✗ failed: $*"
  failed=1
  return 1
}

# at DIR COMMAND…: COMMAND in DIR.
at() {
  local dir="$1"
  shift
  (cd "$dir" && "$@")
}

gofmt_clean() {
  local unformatted
  unformatted="$(gofmt -l .)"
  if [ -n "$unformatted" ]; then
    echo "Files need gofmt:"
    echo "$unformatted"
    return 1
  fi
}

port_free() {
  if lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $1 is in use; the end-to-end tests need it."
    return 1
  fi
}

# start_postgres NAME: a throwaway PostgreSQL 17 on a free port; prints its URL.
start_postgres() {
  local name="$run_id-$1" port
  docker run -d --rm --name "$name" \
    -e POSTGRES_USER=konspecter -e POSTGRES_PASSWORD=konspecter -e POSTGRES_DB=konspecter \
    -p 127.0.0.1::5432 postgres:17-alpine >/dev/null || return 1
  for _ in $(seq 60); do
    # Over TCP: the image's first-start server listens only on its socket.
    if docker exec "$name" pg_isready -U konspecter -h 127.0.0.1 >/dev/null 2>&1; then
      port="$(docker port "$name" 5432/tcp | head -n 1 | sed 's/.*://')"
      echo "postgres://konspecter:konspecter@127.0.0.1:$port/konspecter?sslmode=disable"
      return 0
    fi
    sleep 1
  done
  echo "PostgreSQL ($name) did not start." >&2
  return 1
}

stop_postgres() {
  docker rm -f "$run_id-$1" >/dev/null 2>&1
}

# wait_for URL: until something answers at URL (any status), for up to two minutes.
wait_for() {
  for _ in $(seq 120); do
    curl -s -o /dev/null "$1" && return 0
    sleep 1
  done
  echo "Nothing answered at $1."
  return 1
}

# --- Jobs (one per CI job) ------------------------------------------------------------------

job_web() {
  run pnpm versions:check
  run pnpm format:check
  run pnpm lint
  run pnpm typecheck
  run pnpm test
  run stress_tests
  run pnpm build
  run pnpm --filter @konspecter/web coverage
  run pnpm licenses:check
  run pnpm audit --audit-level moderate
}

# Four copies each of the web and site suites at the same time.
stress_tests() {
  local pids="" pid status=0 i suite
  for i in 1 2 3 4; do
    for suite in web site; do
      pnpm --filter "@konspecter/$suite" test >"$logs/stress-$suite-$i.log" 2>&1 &
      pids="$pids $!:$suite-$i"
    done
  done
  for entry in $pids; do
    pid="${entry%%:*}"
    if ! wait "$pid"; then
      echo "Stress copy ${entry#*:} failed:"
      tail -n 60 "$logs/stress-${entry#*:}.log"
      status=1
    fi
  done
  [ "$status" = 0 ] && echo "All eight copies passed."
  return "$status"
}

job_server() {
  local url
  run at apps/server gofmt_clean
  run at apps/server go vet ./...
  if url="$(start_postgres server)"; then
    run at apps/server env KONSPECTER_TEST_DATABASE_URL="$url" go test -race ./...
  else
    echo "✗ failed: PostgreSQL for go test"
    failed=1
  fi
  stop_postgres server
  run at apps/server go run golang.org/x/vuln/cmd/govulncheck@latest ./...
  run at apps/server go run github.com/google/go-licenses/v2@v2.0.1 check ./... \
    --allowed_licenses=MIT,BSD-2-Clause,BSD-3-Clause,Apache-2.0,ISC \
    --ignore konspecter/server
}

job_desktop() {
  # tauri::generate_context needs a web build; CI uses a placeholder, here the last real
  # build is kept when there is one.
  if [ ! -f apps/web/dist/index.html ]; then
    mkdir -p apps/web/dist && echo '<!doctype html>' >apps/web/dist/index.html
  fi
  local dir=apps/desktop/src-tauri
  run at "$dir" cargo fmt --check
  run at "$dir" cargo clippy --all-targets -- -D warnings
  run at "$dir" cargo test
  run at "$dir" cargo deny check licenses advisories
}

job_android() {
  run pnpm --filter @konspecter/mobile sync
  run at apps/mobile/android ./gradlew assembleDebug
}

job_e2e() {
  local url server_pid="" site_pid="" token mail_log="$logs/e2e-server.log" bin="$logs/server"
  run port_free "${e2e_server_addr##*:}" || return
  run port_free "$e2e_site_port" || return
  run port_free "$e2e_preview_port" || return
  run pnpm --filter @konspecter/e2e exec playwright install chromium || return
  url="$(start_postgres e2e)" || {
    echo "✗ failed: PostgreSQL for the end-to-end tests"
    failed=1
    return
  }

  export KONSPECTER_DATABASE_URL="$url"
  export KONSPECTER_ADDR="$e2e_server_addr"
  export KONSPECTER_ALLOWED_ORIGINS="http://localhost:$e2e_preview_port"
  export KONSPECTER_PUBLIC_URL="http://localhost:$e2e_site_port"
  export KONSPECTER_API_URL="http://$e2e_server_addr"
  export KONSPECTER_MAIL_TRANSPORT=log

  if run at apps/server go build -o "$bin" ./cmd/server &&
    token="$("$bin" create-user -email e2e@example.com | awk '/^token/{print $2}')" &&
    [ -n "$token" ]; then
    "$bin" serve >"$mail_log" 2>&1 &
    server_pid=$!
    pnpm dev:site >"$logs/e2e-site.log" 2>&1 &
    site_pid=$!
    if run wait_for "http://$e2e_server_addr/" && run wait_for "http://localhost:$e2e_site_port/"; then
      run env KONSPECTER_E2E_URL="http://$e2e_server_addr" KONSPECTER_E2E_TOKEN="$token" \
        KONSPECTER_E2E_SITE_URL="http://localhost:$e2e_site_port" \
        KONSPECTER_E2E_MAIL_LOG="$mail_log" pnpm e2e
    fi
  else
    echo "✗ failed: the server for the end-to-end tests (build or create-user)"
    failed=1
  fi

  [ -n "$site_pid" ] && kill_tree "$site_pid"
  [ -n "$server_pid" ] && kill_tree "$server_pid"
  stop_postgres e2e
  echo "Server log: $mail_log; site log: $logs/e2e-site.log"
}

# The images as release.yml builds them, for this machine's platform only (CI builds
# amd64 and arm64); not tagged, so nothing is left behind but the build cache.
job_images() {
  run docker buildx build --output type=cacheonly -f apps/server/Dockerfile apps/server
  run docker buildx build --output type=cacheonly -f apps/site/Dockerfile .
  run docker buildx build --output type=cacheonly -f apps/web/Dockerfile .
}

# --- Running --------------------------------------------------------------------------------

# job NAME: runs job_NAME with its output in its log; records ok or failed.
job() {
  local name="$1" start status
  start="$(date +%s)"
  echo "  … $name"
  # A subshell: a job's directory and variables stay its own.
  if (
    failed=0
    "job_$name"
    exit "$failed"
  ) >"$logs/$name.log" 2>&1; then
    status=ok
  else
    status=failed
  fi
  echo "$status" >"$logs/$name.status"
  echo "  $([ "$status" = ok ] && echo ✓ || echo ✗) $name ($(($(date +%s) - start))s)"
}

started="$(date +%s)"
echo "Running every CI check (logs in $logs)…"

echo "  … pnpm install --frozen-lockfile"
if ! pnpm install --frozen-lockfile >"$logs/install.log" 2>&1; then
  tail -n 40 "$logs/install.log"
  echo "✗ pnpm install --frozen-lockfile failed; nothing else was run."
  exit 1
fi

(job desktop && job web && job e2e && job android) &
job server &
job images &
wait

echo
result=0
for name in desktop web e2e android server images; do
  if [ "$(cat "$logs/$name.status" 2>/dev/null)" != ok ]; then
    result=1
    echo "━━━ $name failed — the end of $logs/$name.log ━━━"
    tail -n 80 "$logs/$name.log"
    echo
  fi
done

took=$(($(date +%s) - started))
if [ "$result" = 0 ]; then
  echo "✓ Every check passed ($((took / 60))m $((took % 60))s)."
  rm -rf "$logs"
else
  echo "✗ Some checks failed ($((took / 60))m $((took % 60))s). Logs: $logs"
fi
exit "$result"
