import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { vitestMockBaseline } from "./mock-baseline.ts";

const repository = fileURLToPath(new URL("../../..", import.meta.url));

const testFile = /\.(test|spec)\.[cm]?[jt]sx?$/;
// The ratchet baseline already covers module mocks, including aliased vi
// bindings. Fake clocks are not covered by the lint rule, so find those in
// source. vi.fn is harmless, but over-isolating a few files is cheap insurance.
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

const clockFiles = ["apps", "packages"]
  .flatMap((directory) => [...walk(path.join(repository, directory))])
  .flatMap((file) =>
    fakeTime.test(readFileSync(file, "utf8"))
      ? [path.relative(repository, file).split(path.sep).join("/")]
      : [],
  );

/**
 * Repo-relative POSIX paths of tests that replace modules or pin time. The
 * lint-enforced ratchet is the source of truth for module mocks; the source
 * scan adds fake clocks, which the lint rule does not cover.
 */
export const isolatedTestFiles: ReadonlyArray<string> = [
  ...new Set([...Object.keys(vitestMockBaseline), ...clockFiles]),
];
