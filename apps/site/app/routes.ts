import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("login", "routes/login.tsx"),
  route("login/code", "routes/login-code.tsx"),
  route("register", "routes/register.tsx"),
  route("forgot", "routes/forgot.tsx"),
  route("reset", "routes/reset.tsx"),
  route("complete", "routes/complete.tsx"),
  route("settings", "routes/settings.tsx"),
  route("activate", "routes/activate.tsx"),
  route("logout", "routes/logout.ts"),
  route("preferences", "routes/preferences.ts"),
  route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
