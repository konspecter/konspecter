/** A note as the server has it. */
export type RemoteNote = {
  readonly id: string;
  readonly markdown: string;
  readonly revision: number;
  readonly deleted: boolean;
};

/**
 * Why a note is not being synced: its local and server versions both changed
 * (a conflict, settled at the end of the sync cycle), or the server refused it.
 */
export type SyncBlock =
  | { readonly reason: "conflict"; readonly remote: RemoteNote | null }
  | { readonly reason: "rejected"; readonly message: string };

/**
 * Per-note sync bookkeeping. The dirty entries are the offline queue: however
 * many times a note is edited offline, it is pushed once, as it is now.
 */
export type SyncEntry = {
  readonly noteId: string;
  /** The server revision the local copy is based on; null if never synced. */
  readonly baseRevision: number | null;
  /** Local changes that the server does not have yet. */
  readonly dirty: boolean;
  /** Deleted locally; the deletion still has to reach the server. */
  readonly deleted: boolean;
  readonly blocked: SyncBlock | null;
};

export class InvalidSyncStateError extends Error {
  override readonly name = "InvalidSyncStateError";
}

export function parseRemoteNote(value: unknown): RemoteNote {
  if (typeof value !== "object" || value === null) {
    throw new InvalidSyncStateError("Server note is not an object");
  }
  const {
    id,
    markdown,
    revision,
    deleted_at: deletedAt,
    deleted,
  } = value as Record<string, unknown>;
  if (typeof id !== "string" || id === "" || typeof markdown !== "string") {
    throw new InvalidSyncStateError("Server note has no id or Markdown");
  }
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 1) {
    throw new InvalidSyncStateError(`Server note ${id} has an invalid revision`);
  }
  const isDeleted =
    typeof deleted === "boolean" ? deleted : deletedAt !== undefined && deletedAt !== null;
  return { id, markdown, revision, deleted: isDeleted };
}

export function parseSyncEntry(value: unknown): SyncEntry {
  if (typeof value !== "object" || value === null) {
    throw new InvalidSyncStateError("Sync entry is not an object");
  }
  const { noteId, baseRevision, dirty, deleted, blocked } = value as Record<string, unknown>;
  if (typeof noteId !== "string" || noteId === "") {
    throw new InvalidSyncStateError("Sync entry has no note id");
  }
  if (
    baseRevision !== null &&
    (typeof baseRevision !== "number" || !Number.isInteger(baseRevision))
  ) {
    throw new InvalidSyncStateError(`Sync entry ${noteId} has an invalid base revision`);
  }
  if (typeof dirty !== "boolean" || typeof deleted !== "boolean") {
    throw new InvalidSyncStateError(`Sync entry ${noteId} has invalid flags`);
  }
  return { noteId, baseRevision, dirty, deleted, blocked: parseSyncBlock(blocked) };
}

export function parseSyncBlock(value: unknown): SyncBlock | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") throw new InvalidSyncStateError("Invalid sync block");
  const { reason, remote, message } = value as Record<string, unknown>;
  if (reason === "conflict") {
    return {
      reason,
      remote: remote === null || remote === undefined ? null : parseRemoteNote(remote),
    };
  }
  if (reason === "rejected" && typeof message === "string") {
    return { reason, message };
  }
  throw new InvalidSyncStateError("Invalid sync block");
}

/** Whether a sync cycle should push this entry. */
export function isPending(entry: SyncEntry): boolean {
  return entry.dirty && entry.blocked === null;
}
