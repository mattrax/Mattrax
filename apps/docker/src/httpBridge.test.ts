import { createServer, request } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Effect, Exit, Scope } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { makeApiHttpHandler } from "./httpBridge.js";
import type { ApiRuntime, RuntimeContext } from "./httpBridge.js";

const context: RuntimeContext = {
  waitUntil: () => {},
  passThroughOnException: () => {},
};

const scopes: Array<Scope.Closeable> = [];
const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => {
            resolve();
          });
          server.closeAllConnections();
        }),
    ),
  );
  await Promise.all(
    scopes.splice(0).map((scope) => Effect.runPromise(Scope.close(scope, Exit.void))),
  );
});

const serve = async (api: ApiRuntime): Promise<string> => {
  const scope = await Effect.runPromise(Scope.make());
  scopes.push(scope);
  const handler = await Effect.runPromise(makeApiHttpHandler(api, context, scope));
  const server = createServer((incoming: IncomingMessage, response: ServerResponse) => {
    handler(incoming, response);
  });
  servers.push(server);

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });
  const address = server.address();

  if (address === null || typeof address === "string") throw new Error("server did not bind");

  return `http://127.0.0.1:${address.port}`;
};

const collect = (url: string, headers?: Record<string, string>) =>
  new Promise<{ status: number | undefined; body: string; failed: boolean }>((resolve) => {
    const outgoing = request(url, { headers }, (response) => {
      let body = "";
      let failed = false;
      response.on("data", (chunk) => {
        body += String(chunk);
      });
      const finish = () => {
        resolve({ status: response.statusCode, body, failed });
      };
      response.on("aborted", () => {
        failed = true;
        finish();
      });
      response.on("error", () => {
        failed = true;
        finish();
      });
      response.on("end", finish);
    });
    outgoing.on("error", () => {
      resolve({ status: undefined, body: "", failed: true });
    });
    outgoing.end();
  });

const runtime = (fetch: ApiRuntime["fetch"]): ApiRuntime => ({
  fetch,
  scheduled: async () => {},
});

describe("Node Effect HTTP bridge", () => {
  it("overwrites a caller-forged internal peer address with the real socket peer", async () => {
    let observedPeer: string | null = null;
    let observedCertificate: string | null = null;
    let observedDer: string | null = null;
    const url = await serve(
      runtime(async (incoming) => {
        observedPeer = incoming.headers.get("x-mattrax-peer-address");
        observedCertificate = incoming.headers.get("x-device-identity-certificate");
        observedDer = incoming.headers.get("x-device-identity-certificate-der-base64");

        return new Response("ok");
      }),
    );

    await collect(url, {
      "x-mattrax-peer-address": "10.0.0.2",
      "x-device-identity-certificate": "CN=device-dummy,OU=org-dummy",
      "x-device-identity-certificate-der-base64": "ZHVtbXktZGVy",
    });

    expect(observedPeer).toBe("127.0.0.1");
    expect(observedCertificate).toBe("CN=device-dummy,OU=org-dummy");
    expect(observedDer).toBe("ZHVtbXktZGVy");
  });

  it("returns one bounded error response when fetching fails before headers", async () => {
    const url = await serve(
      runtime(async () => {
        throw new Error("upstream failed");
      }),
    );
    const response = await collect(url);

    expect(response.status).toBe(500);
    expect(response.body).toBe("Internal Server Error");
  });

  it("never appends an error body after response streaming starts", async () => {
    const url = await serve(
      runtime(async () => {
        let pulled = false;
        const body = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (!pulled) {
              pulled = true;
              controller.enqueue(new TextEncoder().encode("prefix-"));
            } else {
              setTimeout(() => controller.error(new Error("stream failed")), 10);
            }
          },
        });

        return new Response(body, { status: 200 });
      }),
    );
    const response = await collect(url);

    expect(response.status).toBe(200);
    expect(response.body).toBe("prefix-");
    expect(response.body).not.toContain("Internal Server Error");
  });

  it("cancels the request fiber when the client disconnects", async () => {
    let started!: () => void;
    let aborted!: () => void;
    const didStart = new Promise<void>((resolve) => {
      started = resolve;
    });
    const didAbort = new Promise<void>((resolve) => {
      aborted = resolve;
    });
    const url = await serve(
      runtime(
        (_request, requestContext) =>
          new Promise<Response>((resolve) => {
            started();
            requestContext.signal!.addEventListener("abort", () => {
              aborted();
              resolve(new Response("late"));
            });
          }),
      ),
    );
    const outgoing = request(url);
    outgoing.on("error", () => {});
    outgoing.end();
    await didStart;
    outgoing.destroy();
    await didAbort;
  });
});
