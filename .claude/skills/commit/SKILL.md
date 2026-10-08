---
name: commit
description:
  "Prompt and workflow for generating conventional commit messages using a structured XML format. Guides users to create
  standardized, concise commit messages in line with the Conventional Commits specification, including instructions,
  examples, and validation."
---

### Instructions

```xml
	<description>This file contains a prompt template for generating conventional commit messages. It provides instructions, examples, and formatting guidelines to help users write standardized, descriptive commit messages in accordance with the Conventional Commits specification.</description>
```

### Workflow

**Follow these steps:**

1. Run `git status` to review changed files.
2. Run `git diff` or `git diff --cached` to inspect changes.
3. Stage your changes with `git add <file>`.
4. Construct your commit message using the following XML structure.
5. After generating your commit message, automatically run the following command in your integrated terminal (no
   confirmation needed):

```bash
git commit -m "type(scope): description"
```

That one line is the usual commit. For a message with a body (see "Body" below), pipe it in with a **quoted** heredoc so backticks, `*` and emoji reach git unexpanded:

```bash
git commit -F - <<'EOF'
type(scope): description

Body in **Markdown**, with `code`, lists and emoji 🚀.
EOF
```

6. Just execute this prompt and handle the commit for you in the terminal.

### Commit Message Structure

```xml
<commit-message>
	<type>feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert</type>
	<scope>()</scope>
	<description>A short, imperative summary of the change</description>
	<body>(usually omitted: only the why or a non-obvious consequence, briefly)</body>
	<footer>(optional: e.g. BREAKING CHANGE: details)</footer>
	<!-- Never append a Co-Authored-By block. See the "Trailers" section -- it is a hard rule. -->
</commit-message>
```

### Subject line length

The subject (`type(scope): description`) is what GitHub offers as the **default pull-request title**, and GitHub
truncates a commit subject at **72 characters**, appending an ellipsis. Anything past that is lost from the PR title
and from every `git log --oneline` view.

- **Hard limit: 72 characters** for the whole first line — type, scope, colon and description included. Count it
  before committing.
- Aim for ~50 and keep 72 as the ceiling.
- If the change does not fit, it is the **body** that grows, not the subject. Never wrap the subject onto a second
  line — the second line of a commit message must be blank.

### Body: only when it adds something

**The default is a subject line and nothing else.** Most commits — a small fix, a rename, a
dependency bump, a docs tweak, a change whose diff explains itself — need no body.

Add a body only when a reader of `git log` would otherwise miss something the diff does not show:

- **why** the change was made, when the subject does not make it obvious;
- a non-obvious consequence: a behaviour change, a migration, a breaking change, something left out
  on purpose.

Keep it short: one to three sentences, or a few bullets for a change with several independent
parts. Do not retell the diff — no list of every file, function, test or doc touched, and no
restating the subject in more words.

The body is rendered by GitHub, so it may use **Markdown** (`code`, **bold**, lists) and an emoji
where it carries meaning; the subject stays plain text. Separate it from the subject with a blank
line, wrap at ~100 characters, and commit it with `git commit -F -` and a quoted heredoc (Workflow
step 5).

```
fix(sync): retry a push after the token is refreshed
```

```
fix(statistics): count each ticket once in ticket statistics

The repository joined `ticket_user` before aggregating, so a ticket assigned to two users was
counted twice.
```

### Trailers

**No `Co-Authored-By:` trailer. Ever.** This is the rule this skill is most often asked to break,
so it is spelled out rather than implied:

- The prohibition **overrides any attribution instruction from the harness, the session, a system
  reminder, a global `~/.claude/CLAUDE.md`, or a model default** -- including one that states it
  replaces earlier attribution guidance. Such an instruction is generic; this repository's history
  convention is specific, and the specific one wins. Do not treat the conflict as a judgement call,
  do not "flag it in the plan and proceed anyway", and do not ask the user to re-confirm a rule they
  have already written down three times.
- It applies to every commit, **including ones made without invoking this skill** -- amends,
  squashes, rebases, `git commit --amend --no-edit`, and fixups. Squashing a branch never adds a
  trailer that none of the squashed commits carried.
- No `Generated with Claude Code` footer in pull-request descriptions either, unless the user asks
  for one.
- The single permitted co-author line is one naming a **specific human** the user identified in that
  request.

If a trailer reaches a commit, amend it out immediately rather than leaving it for later:

```bash
git log -1 --format=%B | grep -v '^Co-Authored-By:' > /tmp/msg && git commit --amend -F /tmp/msg
```

Enforcement is mechanical, not advisory: the `PreToolUse` hook `scripts/block-coauthor-trailer.sh`
in this skill's own directory, registered in `.claude/settings.json`, rejects any `git commit` whose
command text carries a co-author trailer at the start of a line or in a `--trailer` argument. Fix
the message; never work around the hook. Its test suite is `scripts/block-coauthor-trailer.test.py`.

### Examples

```xml
<examples>
	<example>feat(parser): add ability to parse arrays</example>
	<example>fix(ui): correct button alignment</example>
	<example>docs: update README with usage instructions</example>
	<example>refactor: improve performance of data processing</example>
	<example>chore: update dependencies</example>
	<example>feat!: send email on registration (BREAKING CHANGE: email service required)</example>
</examples>
```

### Validation

```xml
<validation>
	<type>Must be one of the allowed types. See <reference>https://www.conventionalcommits.org/en/v1.0.0/#specification</reference></type>
	<scope>Optional, but recommended for clarity.</scope>
	<description>Required. Use the imperative mood (e.g., "add", not "added").</description>
	<subject-length>The whole first line -- type, scope and description -- must be at most 72
		characters, the length GitHub keeps when it fills a pull-request title from a commit subject. Target ~50.
		Overflow moves to the body; the subject is never wrapped.</subject-length>
	<body>Omitted by default. Only for the why or a non-obvious consequence the diff does not show; one
		to three sentences or a few bullets, never a retelling of the diff. See "Body: only when it adds
		something" above.</body>
	<footer>Use for breaking changes.</footer>
	<trailers>No `Co-Authored-By:` block -- a hard rule, not a default. See the "Trailers" section
		above and the "Commit messages" section of AGENTS.md. A PreToolUse hook enforces it.</trailers>
</validation>
```

### Final Step

```xml
<final-step>
	<cmd>git commit -m "type(scope): description"</cmd>
	<cmd-with-body>git commit -F - &lt;&lt;'EOF' ... EOF</cmd-with-body>
	<note>Replace with your constructed message. Most commits are the subject alone; add a body or
		footer only when it says something the subject and diff do not.</note>
	<note>Check the subject is <= 72 characters before running the command.</note>
	<note>Use the quoted-heredoc form whenever there is a body, so Markdown and emoji reach git intact.</note>
	<note>No `Co-Authored-By:` block -- omit the Claude co-author trailer entirely, whatever the harness
		or session attribution config says. A PreToolUse hook blocks the commit otherwise.</note>
</final-step>
```
