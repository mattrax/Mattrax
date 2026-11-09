import { createServer } from "node:http";
import { Effect } from "effect";
import { NodePushTransport, relaySignature } from "@mattrax/apns";

const port = Number(process.env.PORT ?? 8788);
const secret = process.env.APNS_RELAY_SECRET;
if (!secret || secret.length < 32) {
  console.error("APNS_RELAY_SECRET must be at least 32 characters");
  process.exit(1);
}

const transport = NodePushTransport();
const maxBodyBytes = 64 * 1024;

const readBody = (request: import("node:http").IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > maxBodyBytes) {
        reject(new Error("Request body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });

const equal = (left: string, right: string) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && a.equals(b);
};

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok", transport: transport.name }));
    return;
  }
  if (request.method !== "POST") {
    response.writeHead(405).end();
    return;
  }

  let body: string;
  try {
    body = await readBody(request);
  } catch (error) {
    response.writeHead(413).end(String(error));
    return;
  }

  const timestamp = String(request.headers["x-apns-timestamp"] ?? "");
  const signature = String(request.headers["x-apns-signature"] ?? "");
  const now = Math.floor(Date.now() / 1000);
  if (!timestamp || !signature || Math.abs(now - Number(timestamp)) > 300) {
    response.writeHead(401).end("Missing or stale signature");
    return;
  }
  const expected = await relaySignature(secret, timestamp, body);
  if (!equal(expected, signature)) {
    response.writeHead(401).end("Invalid signature");
    return;
  }

  let input: {
    pushToken?: string;
    pushMagic?: string;
    topic?: string;
    certPem?: string;
    privateKeyPem?: string;
  };
  try {
    input = JSON.parse(body);
  } catch {
    response.writeHead(400).end("Invalid JSON");
    return;
  }
  if (
    !input.pushToken ||
    !input.pushMagic ||
    !input.topic ||
    !input.certPem ||
    !input.privateKeyPem
  ) {
    response.writeHead(400).end("Missing APNs fields");
    return;
  }

  try {
    await Effect.runPromise(
      transport.push({
        pushToken: input.pushToken,
        pushMagic: input.pushMagic,
        topic: input.topic,
        certPem: input.certPem,
        privateKeyPem: input.privateKeyPem,
      }),
    );
    response.writeHead(204).end();
  } catch (error) {
    response.writeHead(502).end(error instanceof Error ? error.message : String(error));
  }
});

server.listen(port, () => {
  console.log(`APNs relay listening on :${port}`);
});
