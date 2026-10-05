import type { Config } from "@react-router/dev/config";

// Server-rendered: every page is HTML from the server, forms work before
// (and without) JavaScript, and loaders call the Go API on the server.
export default {
  appDirectory: "app",
  ssr: true,
} satisfies Config;
