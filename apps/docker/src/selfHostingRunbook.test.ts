import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const docs = await readFile(
  join(import.meta.dirname, "..", "..", "..", "docs", "operations", "self-hosting.md"),
  "utf8",
);
const script = docs.match(
  /### Device CA bundle[\s\S]*?\u0060\u0060\u0060bash\n([\s\S]*?)\n\u0060\u0060\u0060/,
)?.[1];

if (!script) throw new Error("self-hosting docs do not contain the CA bundle runbook");

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

const setup = async () => {
  const directory = await mkdtemp(join(tmpdir(), "mattrax-ca-runbook-"));
  directories.push(directory);
  const bin = join(directory, "bin");
  const live = join(directory, "tenant-scep-ca-bundle.pem");
  await mkdir(bin);
  await writeFile(live, "previous-bundle\n");
  await writeFile(
    join(bin, "docker"),
    '#!/bin/bash\nif [ "$DOCKER_FAIL" = "1" ]; then exit 1; fi\nprintf "new-bundle\\n"\n',
    { mode: 0o755 },
  );
  await writeFile(
    join(bin, "openssl"),
    '#!/bin/bash\nif [ "$OPENSSL_FAIL" = "1" ]; then exit 1; fi\n',
    { mode: 0o755 },
  );
  await writeFile(
    join(bin, "caddy"),
    '#!/bin/bash\nif [ "$CADDY_FAIL" = "1" ]; then exit 1; fi\n',
    { mode: 0o755 },
  );
  const runnable = script
    .replaceAll("/path/to", directory)
    .replaceAll("/etc/caddy/Caddyfile", join(directory, "Caddyfile"));

  return { directory, bin, live, runnable };
};

const run = (
  runnable: string,
  bin: string,
  directory: string,
  overrides: Record<string, string> = {},
) =>
  spawnSync("/bin/bash", ["-c", runnable], {
    cwd: directory,
    encoding: "utf8",
    env: {
      PATH: bin + ":/usr/bin:/bin",
      HOME: directory,
      ...overrides,
    },
  });

describe("self-host CA bundle runbook", () => {
  it("uses strict shell mode and the bundled MySQL Compose command", () => {
    expect(script).toContain("set -euo pipefail");
    expect(script).toContain("docker compose -f apps/docker/docker-compose.yml exec -T mysql");
    expect(script).toContain('-umattrax -p"$MYSQL_PASSWORD" mattrax');
  });

  it("leaves the live bundle unchanged when the database query fails", async () => {
    const { directory, bin, live, runnable } = await setup();
    const result = run(runnable, bin, directory, { DOCKER_FAIL: "1" });

    expect(result.status).not.toBe(0);
    expect(await readFile(live, "utf8")).toBe("previous-bundle\n");
  });

  it("leaves the live bundle unchanged when certificate validation fails", async () => {
    const { directory, bin, live, runnable } = await setup();
    const result = run(runnable, bin, directory, { OPENSSL_FAIL: "1" });

    expect(result.status).not.toBe(0);
    expect(await readFile(live, "utf8")).toBe("previous-bundle\n");
  });

  it("restores the previous bundle when Caddy reload fails", async () => {
    const { directory, bin, live, runnable } = await setup();
    const result = run(runnable, bin, directory, { CADDY_FAIL: "1" });

    expect(result.status).not.toBe(0);
    expect(await readFile(live, "utf8")).toBe("previous-bundle\n");
    expect(result.stderr).toContain("previous CA bundle restored");
  });

  it("replaces the bundle after a successful query, validation and reload", async () => {
    const { directory, bin, live, runnable } = await setup();
    const result = run(runnable, bin, directory);

    expect(result.status).toBe(0);
    expect(await readFile(live, "utf8")).toBe("new-bundle\n");
  });
});
