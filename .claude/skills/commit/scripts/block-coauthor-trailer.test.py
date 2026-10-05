#!/usr/bin/env python3
"""Test suite for block-coauthor-trailer.sh.

Run it from anywhere:  python3 .claude/skills/commit/scripts/block-coauthor-trailer.test.py

The trailer string is assembled from fragments on purpose. A literal one in this file would be a
line-anchored match, and the hook -- which inspects the raw Bash command text -- would block the
very command that runs these tests.
"""

import json
import os
import subprocess
import sys

HOOK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "block-coauthor-trailer.sh")
TRAILER = "Co-" + "Authored-" + "By: Claude Opus 5 <noreply@anthropic.com>"

BLOCK, ALLOW = 2, 0

CASES = [
    ("plain commit", 'git commit -m "feat: x"', ALLOW),
    ("heredoc with trailer", "git commit -F - <<'EOF'\nfeat: x\n\n" + TRAILER + "\nEOF", BLOCK),
    ("-m with trailer", 'git commit -m "feat: x\n\n' + TRAILER + '"', BLOCK),
    ("--trailer flag", 'git commit -m "feat: x" --trailer "' + TRAILER + '"', BLOCK),
    ("--trailer= form", 'git commit --trailer="' + TRAILER + '" -m "feat: x"', BLOCK),
    ("lowercase spelling", "git commit -F - <<'EOF'\nfeat: x\n\nco-authored-by: a <a@b.c>\nEOF", BLOCK),
    ("amend stripping a trailer", "git log -1 --format=%B | grep -v '^Co-Auth' > /tmp/m"
                                  " && git commit --amend -F /tmp/m", ALLOW),
    ("docs quoting the rule", "cat > AGENTS.md <<MD\nNever add a `Co-Authored-By:` trailer to a"
                              " git commit.\nMD", ALLOW),
    ("non-commit grep", "grep -rn Co-Authored-By .", ALLOW),
    ("unrelated command", "git status --short", ALLOW),
]


def main() -> int:
    failures = 0
    for name, command, expected in CASES:
        payload = json.dumps({"tool_input": {"command": command}})
        result = subprocess.run([HOOK], input=payload, capture_output=True, text=True)
        ok = result.returncode == expected
        failures += not ok
        print(f"{'PASS' if ok else 'FAIL'}  {name:<26} exit={result.returncode} expected={expected}")

    print("\nall pass" if not failures else f"\n{failures} FAILED")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
