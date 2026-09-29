# ADR-003: Local-first

Status: accepted (2026-09-28)

## Context

Reading, writing and searching notes must work on a plane, in a tunnel, or when the server
is down.

## Decision

Clients read and write local storage (IndexedDB on web and mobile). A background sync engine
exchanges document revisions with the server over HTTP/JSON. The UI never waits on the
network for core operations: open, create, edit, search, read, tags.

## Consequences

- Search and tag indexes run on the client.
- Sync must detect conflicts by revision and never lose a document version.
- The server is a sync and backup peer, not the primary store for the UI.
- Data loaded from local storage or the network is validated at the boundary.

## Alternatives considered

- **Server-first with an offline cache**: simpler consistency, but offline editing
  becomes an edge case instead of the default.
- **CRDT-based sync**: stronger merging, but too complex for the MVP. Revision-based sync with
  preservation of the losing version is enough for single-user notes.
