import type { DBSchema } from "idb";
import type { TagEntry } from "./tag-index";

/** The IndexedDB schema. Versions and migrations are in note-store.ts. */
export interface KonspecterDb extends DBSchema {
  notes: {
    key: string;
    // Records are validated on read, so they are typed as unknown here.
    value: unknown;
  };
  tags: {
    key: string;
    value: TagEntry;
    indexes: { memberOf: string };
  };
  meta: {
    key: string;
    value: unknown;
  };
  reading: {
    key: string;
    // Validated on read.
    value: unknown;
  };
  sync: {
    key: string;
    // Validated on read.
    value: unknown;
  };
}
