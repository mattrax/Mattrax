import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fileSystemR2 } from "./r2Node.js";

const roots: string[] = [];

const bucket = async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mattrax-r2-"));

  roots.push(root);

  return { root, r2: fileSystemR2({ root }) };
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
});
