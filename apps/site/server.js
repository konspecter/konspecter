// The site's production server: the React Router build on Express, as
// react-router-serve runs it, but believing the proxy in front. Caddy ends
// TLS and passes the visitor's scheme and host on in X-Forwarded-Proto and
// X-Forwarded-Host; without them every request would read http://…, and
// React Router refuses a form whose Origin (https://…) is not the request's.
// Only a proxy on a private address is believed (Caddy on the compose network,
// one on the same machine), so a visitor cannot claim another scheme or host.
//   KONSPECTER_API_URL=… node server.js   # PORT, default 3000; HOST to bind one address
import express from "express";
import { createRequestHandler } from "@react-router/express";

const build = await import("./build/server/index.js");
const port = Number(process.env.PORT ?? 3000);

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", "loopback, linklocal, uniquelocal");
app.use("/assets", express.static("build/client/assets", { immutable: true, maxAge: "1y" }));
app.use(express.static("build/client"));
app.all("/{*splat}", createRequestHandler({ build, mode: process.env.NODE_ENV }));

const onListen = (error) => {
  if (error) throw error;
  console.log(`Konspecter site on http://localhost:${port}`);
};
const server = process.env.HOST
  ? app.listen(port, process.env.HOST, onListen)
  : app.listen(port, onListen);
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => server.close());
