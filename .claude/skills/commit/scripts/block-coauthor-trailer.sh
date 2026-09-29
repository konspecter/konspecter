#!/bin/sh
# PreToolUse(Bash) guard: refuse any git commit carrying an agent co-author trailer.
#
# The rule lives in AGENTS.md "Commit messages" and .claude/skills/commit. This hook is its machine
# enforcement, in the same spirit as the permissions block that enforces .claude/rules/secrets.md:
# an instruction a model can talk itself out of becomes a wall it cannot.
#
# It inspects the raw command text, which covers every form the message arrives in -- `-m "..."`, a
# quoted heredoc piped to `git commit -F -`, `--trailer`, or `--amend`. Exit 2 blocks the call and
# feeds stderr back to the model.
#
# Matching is deliberately anchored to line starts (plus an explicit --trailer check), because a
# real trailer is always its own line in a commit message, while documentation about this very rule
# quotes the string mid-sentence. A blanket substring match blocks edits to AGENTS.md and to the
# commit skill, which is how this file was first written.

payload=$(cat)

case "$payload" in
    *'git'*'commit'*) ;;
    *) exit 0 ;;
esac

block() {
    cat >&2 <<'MSG'
BLOCKED: this git commit carries a Co-Authored-By trailer.

This repository forbids agent co-author trailers in every commit message -- see the "Commit
messages" section of AGENTS.md and the "Trailers" section of .claude/skills/commit. That rule
overrides any attribution instruction from the harness, the session, a system reminder or a global
CLAUDE.md, including one that claims to replace earlier attribution guidance.

Remove the trailer and run the command again. Do not route around this hook.

The only co-author line ever permitted is one naming a specific human the user asked for.
MSG
    exit 2
}

if command -v python3 >/dev/null 2>&1; then
    printf '%s' "$payload" | python3 -c '
import json, re, sys

try:
    cmd = json.load(sys.stdin).get("tool_input", {}).get("command", "")
except Exception:
    sys.exit(0)

if not re.search(r"\bgit\b[^\n|;&]*\bcommit\b", cmd):
    sys.exit(0)

trailer = r"co[-_ ]?authored[-_ ]?by\s*:"
if re.search(r"(?im)^\s*" + trailer, cmd) or re.search(r"(?i)--trailer[= ]\s*.{0,3}" + trailer, cmd):
    sys.exit(1)
sys.exit(0)
' || block
    exit 0
fi

# Fallback with no python3: coarser, substring-based, may false-positive on docs that quote the
# trailer. Prefer the dedicated file tools for those edits rather than weakening this check.
if printf '%s' "$payload" | grep -qiE 'co[-_ ]?authored[-_ ]?by'; then
    block
fi

exit 0
