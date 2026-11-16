import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

// Generates a self-signed certificate for local HTTPS development. The Vite
// dev server picks it up from `apps/web/.certs` and the API's `ORIGIN` must
// match the resulting `https://localhost:9050` origin.
const dir = path.resolve("apps/web/.certs");
const key = path.join(dir, "localhost-key.pem");
const cert = path.join(dir, "localhost.pem");

if (existsSync(key) && existsSync(cert)) {
  console.log(`Dev certificate already exists at ${dir}`);
  process.exit(0);
}

mkdirSync(dir, { recursive: true });

execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-sha256",
    "-nodes",
    "-keyout",
    key,
    "-out",
    cert,
    "-days",
    "825",
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=DNS:localhost,IP:127.0.0.1",
  ],
  { stdio: "inherit" },
);

console.log(`Generated dev certificate at ${dir}`);
