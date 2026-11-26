import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";

/**
 * Node entry for the self-host target: `dist/server/node.js`.
 *
 * `@solidjs/vite-plugin` can emit one of these itself (`start.nodeServer`), but
 * it refuses to when `start.externalServer` is set — and that option is what
 * hands the server build to us so `src/server/index.ts` stays the entry, as it
 * is for the Worker. This file is that entry's HTTP host: it serves the client
 * build and dispatches everything else through the server bundle's `fetch`.
 *
 * `apps/docker` imports it and drives `listener` from its own server; run
 * directly (`node dist/server/node.js`) it serves on `PORT`/`HOST` itself.
 */

type ServerEntry = { fetch(request: Request): Promise<Response> };

type ServerModule = { default: ServerEntry };

type NodeReadableStream = Parameters<typeof Readable.fromWeb>[0];

const here = import.meta.dirname;

const clientRoot = path.resolve(here, "../client");

const assetsRoot = path.join(clientRoot, "assets") + path.sep;

let entry: Promise<ServerModule> | undefined;

/**
 * The sibling `server.js` bundle, loaded once on the first request.
 *
 * SAFETY: the build emits `server.js` beside this file with the same
 * `default.fetch` shape as the server entry.
 */
const loadEntry = (): Promise<ServerModule> =>
  (entry ??= import(
    /* @vite-ignore */ pathToFileURL(path.join(here, "server.js")).href
  ) as Promise<ServerModule>);

const origin = (request: IncomingMessage): URL => {
  // Behind the self-host reverse proxy the local socket is plain HTTP, so the
  // public origin comes from `ORIGIN` (as it does for the API's Node server);
  // standalone the request's own Host header is the origin.
  const configured = process.env.ORIGIN?.trim();

  if (configured) return new URL(configured);

  const host = request.headers.host ?? "localhost";
  // SAFETY: TLS sockets expose `encrypted`; plain HTTP sockets leave it undefined.
  const protocol = (request.socket as { encrypted?: boolean }).encrypted ? "https" : "http";

  return new URL(`${protocol}://${host}`);
};

const toHeaders = (request: IncomingMessage): Headers => {
  const headers = new Headers();

  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;

    for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
  }

  return headers;
};

type NodeRequestInit = RequestInit & { duplex?: "half" };

const toRequest = (request: IncomingMessage, url: URL, response: ServerResponse): Request => {
  const method = request.method ?? "GET";

  // SAFETY: `toWeb` returns a WHATWG stream of the request bytes; `BodyInit` is
  // the same runtime contract, but Node and DOM declare the stream differently.
  const body: BodyInit | undefined =
    method === "GET" || method === "HEAD" ? undefined : (Readable.toWeb(request) as BodyInit);

  // Stop the render's own outbound calls when the browser goes away.
  const controller = new AbortController();

  response.once("close", () => {
    if (!response.writableEnded) controller.abort();
  });

  const init: NodeRequestInit = {
    method,
    headers: toHeaders(request),
    body,
    signal: controller.signal,
  };

  // Node's fetch requires `duplex` when the body is a stream.
  if (body !== undefined) init.duplex = "half";

  return new Request(url, init);
};

const writeResponse = async (response: ServerResponse, result: Response): Promise<void> => {
  response.statusCode = result.status;

  if (result.statusText) response.statusMessage = result.statusText;

  const cookies = result.headers.getSetCookie();

  result.headers.forEach((value, name) => {
    if (name.toLowerCase() !== "set-cookie") response.setHeader(name, value);
  });

  if (cookies.length > 0) response.setHeader("set-cookie", cookies);

  if (result.body === null || response.req.method === "HEAD") {
    await result.body?.cancel();
    response.end();

    return;
  }

  // SAFETY: a web Response body and `fromWeb` both consume the WHATWG stream
  // contract; only the ambient Node/DOM declarations differ.
  await pipeline(Readable.fromWeb(result.body as NodeReadableStream), response);
};

const MIME = new Map([
  [".avif", "image/avif"],
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".otf", "font/otf"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".ttf", "font/ttf"],
  [".txt", "text/plain; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".webmanifest", "application/manifest+json"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".xml", "application/xml; charset=utf-8"],
]);

/**
 * Routes rendered by the server bundle rather than the static asset layer.
 * Match whole path segments so /login-theme.css and other static files keep
 * their existing behavior. /docs is deliberately absent: Rspress emits it.
 */
const DYNAMIC_PAGE_PREFIXES = [
  "/account",
  "/admin",
  "/api",
  "/accept-invitation",
  "/accept-ownership",
  "/dashboard",
  "/designer",
  "/enroll",
  "/login",
  "/mcp",
  "/mdm",
  "/recover",
  "/register",
  "/scim",
  "/settings",
  "/sso",
  "/t",
  "/tenants",
  "/verify-email",
  "/version",
] as const;

const DYNAMIC_PAGES = new Set(["/", "/privacy", "/terms"]);

const isDynamicPage = (pathname: string): boolean => {
  const normalised = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;

  return (
    DYNAMIC_PAGES.has(normalised) ||
    DYNAMIC_PAGE_PREFIXES.some(
      (prefix) => normalised === prefix || normalised.startsWith(`${prefix}/`),
    )
  );
};

const isFile = async (file: string) => {
  try {
    const stats = await stat(file);

    return stats.isFile() ? stats : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Candidate files for a request path, in the order Cloudflare's asset layer
 * tries them: a directory index first, then the exact file, then the `.html`
 * sibling Rspress writes (its links omit the extension).
 */
const staticFiles = (pathname: string): string[] => {
  let decoded: string;

  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return [];
  }

  if (isDynamicPage(decoded)) return [];

  // Dotfiles are never assets (and keep `..` out of the join below). The
  // `.well-known` directory is the exception: ARD and security.txt are public
  // discovery documents.
  if (decoded.split("/").some((segment) => segment.startsWith(".") && segment !== ".well-known"))
    return [];

  // Drop trailing slashes so `/docs/` and `/docs` produce the same candidates;
  // `path.join` would otherwise keep the slash and break the `.html` sibling.
  const relative = decoded.replace(/\/+$/, "");
  const file = path.join(clientRoot, relative);
  const extension = path.extname(relative);
  const candidates: string[] = [];

  // `/docs/` and `/docs/getting-started` both resolve to their index.
  if (decoded.endsWith("/") || extension === "") candidates.push(path.join(file, "index.html"));

  if (relative) candidates.push(file);

  if (extension === "") candidates.push(`${file}.html`);

  return candidates.filter((candidate) => candidate.startsWith(clientRoot + path.sep));
};

const sendFile = async (
  request: IncomingMessage,
  response: ServerResponse,
  file: string,
  size: number,
): Promise<void> => {
  const extension = path.extname(file).toLowerCase();

  response.statusCode = 200;
  response.setHeader("content-type", MIME.get(extension) ?? "application/octet-stream");
  response.setHeader("content-length", size);
  // Mirrors `public/_headers`: only the content-hashed bundle output (JS, CSS,
  // fonts, WebAssembly) is immutable; brand assets under `/assets/` keep their
  // names and must revalidate. The rest of the `_headers` policy (notably the
  // docs CSP) is not applied here — `apps/docker` serves for a single origin,
  // so a reverse proxy owns those headers.
  response.setHeader(
    "cache-control",
    file.startsWith(assetsRoot) && [".js", ".css", ".woff2", ".wasm"].includes(extension)
      ? "public, max-age=31536000, immutable"
      : extension === ".ico"
        ? "public, max-age=86400"
        : "public, max-age=0, must-revalidate",
  );
  response.setHeader("x-content-type-options", "nosniff");

  if (request.method === "HEAD") {
    response.end();

    return;
  }

  await pipeline(createReadStream(file), response).catch(() => response.destroy());
};

const sendStatic = async (
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
): Promise<boolean> => {
  if (request.method !== "GET" && request.method !== "HEAD") return false;

  const file = await findStaticFile(pathname);

  if (file) {
    await sendFile(request, response, file.path, file.size);

    return true;
  }

  return false;
};

/**
 * Probe all candidates at once, then select in the original asset-layer order:
 * directory index, exact file, then .html sibling. Dynamic pages return no
 * candidates and therefore perform no filesystem work before SSR.
 */
export const findStaticFile = async (
  pathname: string,
): Promise<{ path: string; size: number } | undefined> => {
  const candidates = staticFiles(pathname);
  const probed = await Promise.all(
    candidates.map(async (candidate) => ({ candidate, stats: await isFile(candidate) })),
  );
  const match = probed.find(({ stats }) => stats !== undefined);

  return match?.stats ? { path: match.candidate, size: match.stats.size } : undefined;
};

/** An `http.createServer` request handler; `apps/docker` calls it directly. */
export const listener = async (
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> => {
  try {
    const url = new URL(request.url ?? "/", origin(request));

    if (await sendStatic(request, response, url.pathname)) return;

    const server = await loadEntry();

    await writeResponse(response, await server.default.fetch(toRequest(request, url, response)));
  } catch (error) {
    console.error("[selfhost] dashboard request failed", error);

    if (response.headersSent) {
      response.destroy();

      return;
    }

    response.statusCode = 500;
    response.setHeader("content-type", "text/plain; charset=utf-8");
    response.end("Internal Server Error");
  }
};

export const serve = ({
  port = Number(process.env.PORT ?? 3000),
  host = process.env.HOST,
} = {}) => {
  const server = createServer((request, response) => void listener(request, response));

  server.listen(port, host, () =>
    console.log(`Listening on http://${host ?? "localhost"}:${port}`),
  );

  return server;
};

// Only bind a port when run directly; `apps/docker` owns the real server.
if (process.argv[1] && path.resolve(process.argv[1]) === path.join(here, "node.js")) serve();
