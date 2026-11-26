import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, FileSystem, PlatformError } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { fileSystemR2 } from "./r2Node.js";

const roots: string[] = [];

const bucket = async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mattrax-r2-"));

  roots.push(root);

  const r2 = await Effect.runPromise(
    fileSystemR2({ root }).pipe(Effect.provide(NodeFileSystem.layer)),
  );

  return { root, r2 };
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("filesystem R2", () => {
  it("round-trips an object and reads it back as text", async () => {
    const { r2 } = await bucket();

    const put = await r2.put("tenant/doc.txt", "hello", {
      httpMetadata: { contentType: "text/plain" },
      customMetadata: { owner: "acme" },
    });

    expect(put.key).toBe("tenant/doc.txt");
    expect(put.size).toBe(5);

    const head = await r2.head("tenant/doc.txt");

    expect(head).toMatchObject({
      key: "tenant/doc.txt",
      size: 5,
      httpMetadata: { contentType: "text/plain" },
      customMetadata: { owner: "acme" },
    });

    const get = await r2.get("tenant/doc.txt");

    expect(await get!.text()).toBe("hello");
    expect(get!.bodyUsed).toBe(true);
    await expect(get!.text()).rejects.toThrow(/already been used/);
  });

  it("accepts streams, views and null bodies", async () => {
    const { r2 } = await bucket();

    await r2.put("stream", new Blob(["streamed"]).stream());
    await r2.put("view", new TextEncoder().encode("view"));
    await r2.put("empty", null);

    expect(await (await r2.get("stream"))!.text()).toBe("streamed");
    expect(await (await r2.get("view"))!.text()).toBe("view");
    expect((await r2.get("empty"))!.size).toBe(0);
  });

  it("returns null for a missing key", async () => {
    const { r2 } = await bucket();

    expect(await r2.head("missing")).toBeNull();
    expect(await r2.get("missing")).toBeNull();
  });

  it("serves a byte range", async () => {
    const { r2 } = await bucket();

    await r2.put("range", "0123456789");

    expect(await (await r2.get("range", { range: { offset: 2, length: 3 } }))!.text()).toBe("234");
    expect(await (await r2.get("range", { range: { suffix: 2 } }))!.text()).toBe("89");
  });

  it("lists by prefix, limits pages and reports a cursor", async () => {
    const { r2 } = await bucket();

    await Promise.all(["a/1", "a/2", "a/3", "b/1"].map((key) => r2.put(key, key)));

    const first = await r2.list({ prefix: "a/", limit: 2 });

    expect(first.objects.map((object) => object.key)).toEqual(["a/1", "a/2"]);
    expect(first.truncated).toBe(true);

    const second = await r2.list({ prefix: "a/", limit: 2, cursor: first.cursor });

    expect(second.objects.map((object) => object.key)).toEqual(["a/3"]);
    expect(second.truncated).toBe(false);
  });

  it("groups delimited prefixes", async () => {
    const { r2 } = await bucket();

    await Promise.all(["a/1", "b/2"].map((key) => r2.put(key, key)));

    const listed = await r2.list({ delimiter: "/" });

    expect(listed.delimitedPrefixes).toEqual(["a/", "b/"]);
  });

  it("deletes one key or many and refuses traversal", async () => {
    const { r2, root } = await bucket();

    await r2.put("../../escape", "no");
    await r2.put("one", "1");
    await r2.put("two", "2");

    await r2.delete("one");
    await r2.delete(["two"]);

    expect(await r2.head("one")).toBeNull();
    expect(await r2.head("two")).toBeNull();
    expect(await r2.head("../../escape")).not.toBeNull();

    const { readdir } = await import("node:fs/promises");

    expect(await readdir(root)).toEqual(expect.arrayContaining(["meta", "objects"]));
  });

  it("propagates metadata parse failures instead of treating them as missing", async () => {
    const { r2, root } = await bucket();
    const key = "broken";
    const metadataPath = path.join(
      root,
      "meta",
      `${Buffer.from(key, "utf8").toString("base64url")}.json`,
    );
    await mkdir(path.dirname(metadataPath), { recursive: true });
    await writeFile(metadataPath, "{not json", "utf8");

    await expect(r2.head(key)).rejects.toThrow();
    await expect(r2.get(key)).rejects.toThrow();
    await expect(r2.list()).rejects.toThrow();
  });

  it("distinguishes a missing body from a body read failure", async () => {
    const stored = {
      key: "denied",
      size: 3,
      etag: "etag",
      uploaded: "2026-11-24T00:00:00.000Z",
    };
    const permissionDenied = PlatformError.systemError({
      _tag: "PermissionDenied",
      module: "FileSystem",
      method: "readFile",
    });
    const r2 = await Effect.runPromise(
      fileSystemR2({ root: "/unused" }).pipe(
        Effect.provide(
          FileSystem.layerNoop({
            readFileString: () => Effect.succeed(JSON.stringify(stored)),
            readFile: () => Effect.fail(permissionDenied),
          }),
        ),
      ),
    );

    await expect(r2.get("denied")).rejects.toThrow(/PermissionDenied/);
  });

  it("propagates directory failures and only treats not-found as empty", async () => {
    const permissionDenied = PlatformError.systemError({
      _tag: "PermissionDenied",
      module: "FileSystem",
      method: "readDirectory",
    });
    const notFound = PlatformError.systemError({
      _tag: "NotFound",
      module: "FileSystem",
      method: "readDirectory",
    });
    const failing = await Effect.runPromise(
      fileSystemR2({ root: "/unused" }).pipe(
        Effect.provide(
          FileSystem.layerNoop({ readDirectory: () => Effect.fail(permissionDenied) }),
        ),
      ),
    );
    const missing = await Effect.runPromise(
      fileSystemR2({ root: "/unused" }).pipe(
        Effect.provide(FileSystem.layerNoop({ readDirectory: () => Effect.fail(notFound) })),
      ),
    );

    await expect(failing.list()).rejects.toThrow(/PermissionDenied/);
    await expect(missing.list()).resolves.toEqual({
      objects: [],
      truncated: false,
      delimitedPrefixes: [],
    });
  });

  it("removes scoped temporary files when an atomic write fails", async () => {
    const { root } = await bucket();
    const fs = await Effect.runPromise(
      Effect.service(FileSystem.FileSystem).pipe(Effect.provide(NodeFileSystem.layer)),
    );
    const r2 = await Effect.runPromise(
      fileSystemR2({ root }).pipe(
        Effect.provide(
          FileSystem.layerNoop({
            ...fs,
            rename: () =>
              Effect.fail(
                PlatformError.systemError({
                  _tag: "PermissionDenied",
                  module: "FileSystem",
                  method: "rename",
                }),
              ),
          }),
        ),
      ),
    );

    await expect(r2.put("failed", "bytes")).rejects.toThrow(/PermissionDenied/);
    expect(await readdir(path.join(root, "objects"))).toEqual([]);
    expect(await readdir(path.join(root, "meta"))).toEqual([]);
  });

  it("bounds concurrent removals", async () => {
    let active = 0;
    let maximum = 0;
    const r2 = await Effect.runPromise(
      fileSystemR2({ root: "/unused" }).pipe(
        Effect.provide(
          FileSystem.layerNoop({
            remove: () =>
              Effect.gen(function* () {
                active += 1;
                maximum = Math.max(maximum, active);
                yield* Effect.sleep("5 millis");
                active -= 1;
              }),
          }),
        ),
      ),
    );

    await r2.delete(Array.from({ length: 20 }, (_, index) => `key-${index}`));

    expect(maximum).toBeGreaterThan(1);
    expect(maximum).toBeLessThanOrEqual(8);
  });
});
