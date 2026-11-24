import { Effect, FileSystem, Layer, PlatformError } from "effect";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { afterEach, describe, expect, it } from "vitest";
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CliSecureFileStore } from "./secureFileStore.ts";

const directories: Array<string> = [];

const overrideFileSystem = (
  fs: FileSystem.FileSystem,
  overrides: Partial<FileSystem.FileSystem>,
): FileSystem.FileSystem => Object.assign(Object.create(Object.getPrototypeOf(fs)), fs, overrides);

const directory = async () => {
  const path = await mkdtemp(join(tmpdir(), "mattrax-secure-store-"));
  directories.push(path);

  return path;
};

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

const observingFileSystem = (
  onPrivateFile: (
    path: string,
    fs: FileSystem.FileSystem,
  ) => Effect.Effect<void, PlatformError.PlatformError>,
) =>
  Layer.effect(
    FileSystem.FileSystem,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;

      return overrideFileSystem(fs, {
        chmod: (path: string, mode: number) =>
          Effect.gen(function* () {
            if (mode === 0o600) yield* onPrivateFile(path, fs);

            yield* fs.chmod(path, mode);
          }),
      });
    }),
  ).pipe(Layer.provide(NodeFileSystem.layer));

const storeLayer = (fs: Layer.Layer<FileSystem.FileSystem>) =>
  CliSecureFileStore.layer.pipe(Layer.provideMerge(Layer.mergeAll(fs, NodePath.layer)));

describe("CliSecureFileStore", () => {
  it("creates and chmods the temporary file before writing secrets", async () => {
    const root = await directory();
    const destination = join(root, "secret.json");
    const modes: Array<number> = [];
    const layer = storeLayer(
      observingFileSystem((_path, fs) =>
        fs.stat(_path).pipe(
          Effect.tap((info) => Effect.sync(() => modes.push(info.mode & 0o777))),
          Effect.asVoid,
        ),
      ),
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* CliSecureFileStore;

        yield* store.writePrivate(destination, "secret");
      }).pipe(Effect.provide(layer)),
    );

    expect(modes).toEqual([0o600]);
    expect((await stat(destination)).mode & 0o777).toBe(0o600);
    expect(await readFile(destination, "utf8")).toBe("secret");
    expect(await readdir(root)).toEqual(["secret.json"]);
  });

  it("cleans up when writing fails and leaves the destination untouched", async () => {
    const root = await directory();
    const destination = join(root, "secret.json");
    await writeFile(destination, "original", { mode: 0o644 });
    await chmod(destination, 0o644);
    const failingFileSystem = Layer.effect(
      FileSystem.FileSystem,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;

        return overrideFileSystem(fs, {
          writeFileString: (
            path: string,
            data: string,
            options?: Parameters<typeof fs.writeFileString>[2],
          ) =>
            data === ""
              ? fs.writeFileString(path, data, options)
              : Effect.fail(
                  PlatformError.systemError({
                    _tag: "Unknown",
                    module: "FileSystem",
                    method: "writeFileString",
                  }),
                ),
        });
      }),
    ).pipe(Layer.provide(NodeFileSystem.layer));
    const layer = storeLayer(failingFileSystem);

    const exit = await Effect.runPromise(
      Effect.exit(
        Effect.gen(function* () {
          const store = yield* CliSecureFileStore;

          yield* store.writePrivate(destination, "secret");
        }).pipe(Effect.provide(layer)),
      ),
    );

    expect(exit._tag).toBe("Failure");
    expect(await readFile(destination, "utf8")).toBe("original");
    expect(await readdir(root)).toEqual(["secret.json"]);
  });

  it("cleans up when interrupted before publication", async () => {
    const root = await directory();
    const destination = join(root, "secret.json");
    const interruptedFileSystem = Layer.effect(
      FileSystem.FileSystem,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;

        return overrideFileSystem(fs, {
          writeFileString: (
            path: string,
            data: string,
            options?: Parameters<typeof fs.writeFileString>[2],
          ) => (data === "" ? fs.writeFileString(path, data, options) : Effect.never),
        });
      }),
    ).pipe(Layer.provide(NodeFileSystem.layer));
    const layer = storeLayer(interruptedFileSystem);

    await Effect.runPromise(
      Effect.exit(
        Effect.gen(function* () {
          const store = yield* CliSecureFileStore;

          yield* store.writePrivate(destination, "secret");
        }).pipe(Effect.timeout(10), Effect.provide(layer)),
      ),
    );

    expect(await readdir(root)).toEqual([]);
  });

  it("cleans up when publication fails", async () => {
    const root = await directory();
    const destination = join(root, "secret.json");
    const failingRename = Layer.effect(
      FileSystem.FileSystem,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;

        return overrideFileSystem(fs, {
          rename: () =>
            Effect.fail(
              PlatformError.systemError({
                _tag: "Unknown",
                module: "FileSystem",
                method: "rename",
              }),
            ),
        });
      }),
    ).pipe(Layer.provide(NodeFileSystem.layer));
    const layer = storeLayer(failingRename);

    await Effect.runPromise(
      Effect.exit(
        Effect.gen(function* () {
          const store = yield* CliSecureFileStore;

          yield* store.writePrivate(destination, "secret");
        }).pipe(Effect.provide(layer)),
      ),
    );

    expect(await readdir(root)).toEqual([]);
  });
});
