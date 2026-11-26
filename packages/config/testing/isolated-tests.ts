import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../../..", import.meta.url));

const testFile = /\.(test|spec)\.[cm]?[jt]sx?$/;
const fakeTime = /\.(?:useFakeTimers|setSystemTime)\s*\(/;

function* walk(directory: string): Generator<string> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith("."))
      continue;

    const file = path.join(directory, entry.name);

    if (entry.isDirectory()) yield* walk(file);
    else if (testFile.test(entry.name)) yield file;
  }
}

/**
 * Repo-relative POSIX paths of tests that pin the clock. They keep their own
 * module graph so a fake timer cannot leak into the next file. Module mocks
 * are gone, so the lint rule no longer needs a baseline to find exceptions.
 */
export const isolatedTestFiles: ReadonlyArray<string> = ["apps", "packages"]
  .flatMap((directory) => [...walk(path.join(repository, directory))])
  .flatMap((file) =>
    fakeTime.test(readFileSync(file, "utf8"))
      ? [path.relative(repository, file).split(path.sep).join("/")]
      : [],
  );
