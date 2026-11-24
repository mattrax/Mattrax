import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dispose, handler } from "./app.ts";

const page = fileURLToPath(new URL("./index.html", import.meta.url));
const port = Number(process.env.PORT ?? 8787);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://" + (request.headers.host ?? "localhost"));

    if (url.pathname === "/" || url.pathname === "/index.html") {
      const html = await readFile(page);
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(html);
      return;
    }

    const chunks: Array<Buffer> = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;

    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers))
      if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);

    const result = await handler(
      new Request(url, {
        method: request.method,
        headers,
        body,
      }),
    );

    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.flushHeaders();

    if (!result.body) {
      response.end();
      return;
    }

    // Stream rather than buffer: the watch endpoint is Server-Sent Events.
    for await (const chunk of result.body) response.write(Buffer.from(chunk));
    response.end();
  } catch (error) {
    response.writeHead(500, { "content-type": "text/plain" });
    response.end(String(error));
  }
});

server.listen(port, () => {
  console.log("Approvals POC on http://localhost:" + port);
  console.log("OpenAPI:          http://localhost:" + port + "/openapi.json");
});

process.on("SIGINT", () => {
  void dispose().finally(() => process.exit(0));
});
