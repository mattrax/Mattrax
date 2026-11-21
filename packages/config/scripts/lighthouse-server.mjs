import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

/**
 * Production-shaped server for Lighthouse.
 *
 * `pnpm lighthouse` builds the self-host dashboard first, then starts this
 * process. It serves the built Solid SSR bundle and a tiny API stub, so the
 * public pages render with production assets while the dashboard's session
 * probe gets a signed-out answer instead of a gateway error. The API itself is
 * outside the Lighthouse surface; only the dashboard's rendering is measured.
 */

const WEB_PORT = 9050;

const API_PORT = 9051;

process.env.PORT = String(WEB_PORT);

process.env.HOST = "127.0.0.1";

process.env.ORIGIN = `http://localhost:${WEB_PORT}`;

process.env.API_URL = `http://127.0.0.1:${API_PORT}`;

const api = createServer((request, response) => {
  response.statusCode = 200;
  response.setHeader("content-type", "application/json; charset=utf-8");
  // `getSession` is the only public-page API call; a signed-out body is what
  // an anonymous visitor would receive. Anything else is outside this run.
  response.end("null");
});

await new Promise((resolve) => {
  api.listen(API_PORT, "127.0.0.1", resolve);
});

const { listener } = await import(
  pathToFileURL(`${process.cwd()}/apps/web/dist/server/node.js`).href
);

const web = createServer((request, response) => void listener(request, response));

await new Promise((resolve) => {
  web.listen(WEB_PORT, "127.0.0.1", resolve);
});

// Warm the SSR bundle and the discovery documents so Lighthouse never races
// the first render (its metadata fetches are short-lived).
for (const path of [
  "/",
  "/login",
  "/register",
  "/designer",
  "/robots.txt",
  "/llms.txt",
  "/.well-known/ard.json",
]) {
  await fetch(`http://127.0.0.1:${WEB_PORT}${path}`).then((response) => response.arrayBuffer());
}

console.log("Lighthouse server ready");

const shutdown = () => {
  web.close();
  api.close();
  process.exit(0);
};

process.on("SIGTERM", shutdown);

process.on("SIGINT", shutdown);
