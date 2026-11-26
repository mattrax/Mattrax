import { ConfigProvider, Effect, Layer, Option } from "effect";
import { NodeServices } from "@effect/platform-node";
import { afterEach, describe, expect, it } from "vitest";
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  configPath,
  normalizeOrigin,
  readStoredSettings,
  redactSecrets,
  redactToken,
  resolveSettings,
  writeStoredSettings,
} from "./settings.ts";
import { CliSecureFileStore } from "./secureFileStore.ts";

const directories: Array<string> = [];
const runtimeLayer = CliSecureFileStore.layer.pipe(Layer.provideMerge(NodeServices.layer));

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const flags = (overrides: Partial<Parameters<typeof resolveSettings>[0]> = {}) => ({
  url: Option.none<string>(),
  token: Option.none<string>(),
  tenant: Option.none<string>(),
  json: false,
  yes: false,
  ...overrides,
});

const stored = {
  url: "https://file.example",
  token: "mtx_file_token",
  tenant: "file-tenant",
};

const options = (overrides: Partial<Parameters<typeof resolveSettings>[1]> = {}) => ({
  env: {},
  stored,
  configPath: "/tmp/mattrax/config.json",
  ...overrides,
});

describe("resolveSettings", () => {
  it("prefers flags over environment over the file", async () => {
    const settings = await Effect.runPromise(
      resolveSettings(
        flags({ url: Option.some("https://flag.example") }),
        options({
          env: { MATTRAX_URL: "https://env.example" },
        }),
      ),
    );

    expect(settings.url).toBe("https://flag.example");
    expect(settings.sources.url).toBe("flag");
  });

  it("uses environment when a flag is absent", async () => {
    const settings = await Effect.runPromise(
      resolveSettings(
        flags(),
        options({
          env: {
            MATTRAX_URL: "https://env.example",
            MATTRAX_TOKEN: "mtx_env_token",
            MATTRAX_TENANT: "env-tenant",
          },
        }),
      ),
    );

    expect(settings.url).toBe("https://env.example");
    expect(settings.token).toBe("mtx_env_token");
    expect(settings.tenant).toBe("env-tenant");
    expect(settings.sources).toEqual({ url: "env", token: "env", tenant: "env" });
  });

  it("falls back to the stored file and then the Cloud default", async () => {
    const fromFile = await Effect.runPromise(resolveSettings(flags(), options()));

    const fallback = await Effect.runPromise(
      resolveSettings(flags(), options({ stored: undefined, env: {} })),
    );

    expect(fromFile.url).toBe("https://file.example");
    expect(fromFile.token).toBe("mtx_file_token");
    expect(fromFile.tenant).toBe("file-tenant");
    expect(fallback.url).toBe("https://e.mattrax.app");
    expect(fallback.sources.url).toBe("default");
    expect(fallback.token).toBeUndefined();
  });

  it("rejects an empty flag instead of silently ignoring it", async () => {
    const error = await Effect.runPromise(
      Effect.flip(resolveSettings(flags({ token: Option.some("  ") }), options())),
    );

    expect(error._tag).toBe("CliFailure");
    expect(error.message).toContain("--token");
  });
});

describe("normalizeOrigin", () => {
  it("strips trailing slashes and an API suffix", async () => {
    expect(await Effect.runPromise(normalizeOrigin("https://mattrax.test/"))).toBe(
      "https://mattrax.test",
    );
    expect(await Effect.runPromise(normalizeOrigin("https://mattrax.test/api/v1/"))).toBe(
      "https://mattrax.test",
    );
    expect(await Effect.runPromise(normalizeOrigin("mattrax.test"))).toBe("https://mattrax.test");
  });

  it("keeps a self-hosted path prefix", async () => {
    expect(await Effect.runPromise(normalizeOrigin("https://host.test/mdm"))).toBe(
      "https://host.test/mdm",
    );
  });

  it("rejects credentials embedded in the URL", async () => {
    const error = await Effect.runPromise(
      Effect.flip(normalizeOrigin("https://user:pass@host.test")),
    );

    expect(error.message).toContain("must not contain credentials");
  });
});

describe("token redaction", () => {
  it("never returns the full token", () => {
    expect(redactToken("mtx_abcdefghijkl")).toBe("mtx_…ijkl");
    expect(redactToken(undefined)).toBe("(none)");
  });

  it("scrubs tokens from error text", () => {
    expect(redactSecrets("rejected mtx_abcdef123456 for request")).toBe(
      "rejected mtx_…3456 for request",
    );
  });
});

describe("config file", () => {
  it("honours MATTRAX_CONFIG and writes mode 0600", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mattrax-cli-"));
    directories.push(directory);
    const path = join(directory, "nested", "config.json");
    const env = { MATTRAX_CONFIG: path };

    expect(
      await Effect.runPromise(
        configPath.pipe(
          Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown(env)),
          Effect.provide(NodeServices.layer),
        ),
      ),
    ).toBe(path);

    await Effect.runPromise(writeStoredSettings(path, stored).pipe(Effect.provide(runtimeLayer)));

    const mode = (await stat(path)).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(
      await Effect.runPromise(readStoredSettings(path).pipe(Effect.provide(runtimeLayer))),
    ).toEqual(stored);
  });

  it("overwrites a permissive settings file without exposing secrets or temp files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mattrax-cli-"));
    directories.push(directory);
    const path = join(directory, "config.json");
    await writeFile(path, "old", { mode: 0o644 });
    await chmod(path, 0o644);

    await Effect.runPromise(writeStoredSettings(path, stored).pipe(Effect.provide(runtimeLayer)));

    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(stored);
    expect(await readdir(directory)).toEqual(["config.json"]);
  });
});
