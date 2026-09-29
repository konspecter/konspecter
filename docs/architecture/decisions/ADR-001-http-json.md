# ADR-001: HTTP/JSON API

Status: accepted (2026-09-28)

## Context

The server has one job: store users' Markdown documents with revisions and exchange them
with clients (web, desktop, mobile) for sync. The API is small and consumed by our own
clients.

## Decision

Plain HTTP with JSON bodies, resource-style routes (`/api/notes/{id}`), standard status
codes (`409` for revision conflicts), and bearer-token authentication. It is implemented with
Go's standard `net/http` router and `encoding/json`. There is no framework and no generated
code. OpenAPI may be added if the API grows or third-party clients appear.

## Consequences

- Any client can talk to it with `fetch` or `curl`. It is easy to debug and log.
- Request validation (content type, size, unknown fields) is explicit in `httpapi`.
- There is no schema-driven code generation, so client types are written by hand and kept
  in step through tests.

## Alternatives considered

- **gRPC / Connect / Protobuf**: typed contracts and streaming, but browser support needs
  proxies or special clients, and it adds tooling. Excluded by the plan.
- **GraphQL**: flexible queries we do not need, and extra server and client complexity.
  Excluded by the plan.
