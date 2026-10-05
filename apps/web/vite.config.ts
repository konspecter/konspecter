import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

/**
 * Content-Security-Policy for the production build (see docs/security.md).
 * Not in development: Vite's dev server injects inline scripts.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  // React (table alignment) and CodeMirror set inline styles.
  "style-src 'self' 'unsafe-inline'",
  // Notes may show remote images; sync may use any server.
  "img-src 'self' https: http: data: blob:",
  "connect-src 'self' https: http:",
  "font-src 'self' data:",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ");

function csp(): Plugin {
  return {
    name: "konspecter-csp",
    apply: "build",
    transformIndexHtml: () => [
      {
        tag: "meta",
        attrs: { "http-equiv": "Content-Security-Policy", content: contentSecurityPolicy },
        injectTo: "head-prepend",
      },
    ],
  };
}

export default defineConfig({
  plugins: [
    react(),
    csp(),
    VitePWA({
      // Updates wait for the user: an automatic reload could interrupt an edit.
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Konspecter",
        short_name: "Konspecter",
        description: "Local-first technical conspects in Markdown.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#fbfbfa",
        theme_color: "#1f1f1f",
        // The bookmark (scripts/render-icons.mjs): a squircle for "any", full bleed for "maskable".
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Precache the whole app, including the lazily loaded reader, editors,
        // code-language chunks and fonts, so every screen works offline.
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest,woff2}"],
        navigateFallback: "/index.html",
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Remote images in notes: show the last copy when offline.
            urlPattern: ({ request }) => request.destination === "image",
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "note-images",
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  test: {
    environment: "jsdom",
    globals: true,
    restoreMocks: true,
    setupFiles: ["./src/test-setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/**/fake-*.ts", "src/**/test-*.ts", "src/main.tsx"],
      reporter: ["text-summary", "html"],
    },
  },
});
