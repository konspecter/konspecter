import { index, prefix, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  // The public pages (pages.ts): in English here, in Russian under /ru.
  index("routes/home.tsx"),
  route("markdown", "routes/markdown.tsx"),
  route("terms", "routes/terms.tsx"),
  route("privacy", "routes/privacy.tsx"),
  ...prefix("ru", [
    index("routes/home.tsx", { id: "ru/home" }),
    route("markdown", "routes/markdown.tsx", { id: "ru/markdown" }),
    route("terms", "routes/terms.tsx", { id: "ru/terms" }),
    route("privacy", "routes/privacy.tsx", { id: "ru/privacy" }),
    route("*", "routes/ru-other.ts"),
  ]),
  route("robots.txt", "routes/robots.ts"),
  route("sitemap.xml", "routes/sitemap.ts"),
  route("login", "routes/login.tsx"),
  route("login/code", "routes/login-code.tsx"),
  route("register", "routes/register.tsx"),
  route("forgot", "routes/forgot.tsx"),
  route("reset", "routes/reset.tsx"),
  route("complete", "routes/complete.tsx"),
  route("settings", "routes/settings.tsx"),
  route("activate", "routes/activate.tsx"),
  route("connect", "routes/connect.tsx"),
  route("subscription/return", "routes/subscription-return.tsx"),
  route("logout", "routes/logout.ts"),
  route("preferences", "routes/preferences.ts"),
  route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
