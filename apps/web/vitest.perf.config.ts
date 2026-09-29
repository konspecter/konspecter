import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vite.config.ts";

/** Performance measurements only (`pnpm bench`); never part of `pnpm test`. */
export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: ["src/performance/**/*.perf.ts"],
      silent: false,
      coverage: { enabled: false },
    },
  }),
);
