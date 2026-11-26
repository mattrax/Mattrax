import { Context, Effect, FileSystem, Layer, Path } from "effect";
import { CliFailure } from "./failure.ts";

export interface CliSecureFileStoreContract {
  readonly writePrivate: (path: string, contents: string) => Effect.Effect<void, CliFailure>;
}

/** Publish sensitive files through a private, same-filesystem temporary path. */
export class CliSecureFileStore extends Context.Service<
  CliSecureFileStore,
  CliSecureFileStoreContract
>()("@mattrax/cli/CliSecureFileStore") {
  static readonly layer = Layer.effect(
    CliSecureFileStore,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const paths = yield* Path.Path;

      const writePrivate = Effect.fnUntraced(function* (destination: string, contents: string) {
        const directory = paths.dirname(destination);
        const failure = () =>
          new CliFailure({
            message: `Could not write "${destination}".`,
            hint: "Choose a writable path outside shared directories.",
          });

        yield* Effect.gen(function* () {
          const temporaryDirectory = yield* fs.makeTempDirectoryScoped({
            directory,
            prefix: ".mattrax-secure-",
          });
          const temporaryFile = paths.join(temporaryDirectory, "contents");

          // Create an empty private file, correct its mode, and only then write
          // secrets. The temporary directory is mode 0700 and is removed even
          // when publication fails or the fiber is interrupted.
          yield* fs.writeFileString(temporaryFile, "", { flag: "wx", mode: 0o600 });
          yield* fs.chmod(temporaryFile, 0o600);
          yield* fs.writeFileString(temporaryFile, contents, { flag: "w", mode: 0o600 });
          yield* fs.rename(temporaryFile, destination);
        }).pipe(Effect.scoped, Effect.mapError(failure));
      });

      return CliSecureFileStore.of({ writePrivate });
    }),
  );
}
