import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vitest/config";

// In development the site and the Go API share one origin, as behind the
// production proxy: /api/* goes to the server (KONSPECTER_API_URL).
const apiUrl = process.env.KONSPECTER_API_URL ?? "http://localhost:8080";

export default defineConfig({
  // Vitest renders components on their own, without the framework plugin.
  plugins: process.env.VITEST ? [] : [reactRouter()],
  server: {
    port: 5174,
    // The API answers CORS for the apps' origins (KONSPECTER_ALLOWED_ORIGINS):
    // Vite's own CORS would answer their preflights first, and refuse
    // tauri://localhost and the like.
    cors: false,
    proxy: { "/api": { target: apiUrl, changeOrigin: false } },
  },
  test: {
    environment: "jsdom",
    globals: true,
    restoreMocks: true,
    testTimeout: 20_000,
    setupFiles: ["./app/test-setup.ts"],
  },
});
