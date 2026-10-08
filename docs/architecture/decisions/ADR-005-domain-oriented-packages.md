# ADR-005: Domain-oriented packages

Status: accepted (2026-09-28)

## Context

The codebase should be understandable to someone who opens it a year from now to change one
feature. Layer-first layouts (`domain/`, `application/`, `infrastructure/` everywhere)
scatter one feature across many folders and invite ceremony such as `ServiceImpl`,
mappers and factories.

## Decision

- **Go server:** packages are named after domain capabilities (`notes`, `tags`, `search`,
  `sync`, `reading`) under `internal/`, with entry points in `cmd/`. Interfaces are
  declared by consumers at real boundaries (e.g. storage). No generic packages (`utils`,
  `common`, `types`).
- **Frontend:** the `domain/application/infrastructure/presentation` split is a guide,
  not a mandate. A folder or package is created when there is code with its own
  responsibility to put in it.

## Consequences

- One feature is mostly in one place.
- Structure grows with the code, so early phases have deliberately few folders.
- Reviewers should reject empty layers and single-implementation interfaces that exist only
  "for the future".

## Alternatives considered

- **Strict Clean Architecture layering**: clear dependency rules, but a lot of boilerplate for
  a small single-user product.
- **Flat single package**: fine at first, but it would not scale to sync, search and file
  mode.
