import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { configure } from "@testing-library/react";

// Key derivation and IndexedDB take longer on a busy CI machine than the default second.
configure({ asyncUtilTimeout: 5_000 });
