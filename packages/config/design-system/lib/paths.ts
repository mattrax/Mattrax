// Vendored from outtrue (MIT). Kept upstream-compatible.
// oxlint-disable quality/no-array-filter-map
import { existsSync, readdirSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";

export function resolveImport(
  file: string,
  source: string,
  alias: Record<string, string>,
) {
  if (source.startsWith(".")) {
    return posix.join(posix.dirname(file), source);
  }
  const prefix = Object.keys(alias).find((key) => source.startsWith(key));
  return prefix ? `${alias[prefix]}${source.slice(prefix.length)}` : null;
}

export function isUnder(file: string, folders: string[]) {
  return folders.some((folder) =>
    file.startsWith(folder.endsWith("/") ? folder : `${folder}/`),
  );
}

export const SOURCE_FILE = /\.(?:tsx?|jsx?)$/;

export function sourceFiles(cwd: string, folder: string): string[] {
  const root = join(cwd, folder);
  if (!existsSync(root)) {
    return [];
  }
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && SOURCE_FILE.test(entry.name))
    .map((entry) =>
      relative(cwd, join(entry.parentPath, entry.name)).split(sep).join("/"),
    )
    .toSorted();
}

export function missingFolder(
  cwd: string,
  entry: string,
  alias: Record<string, string>,
) {
  const prefix = Object.keys(alias).find((key) => entry.startsWith(key));
  const folder = (
    prefix ? `${alias[prefix]}${entry.slice(prefix.length)}` : entry
  ).replace(/\/$/, "");
  const [root = ""] = folder.split("/");
  return existsSync(join(cwd, root)) && !existsSync(join(cwd, folder))
    ? folder
    : null;
}

const TEST_FILE = /\.(?:test|spec|stories)\.[jt]sx?$/;

export function componentKey(file: string) {
  return posix
    .basename(file)
    .replace(/\..+$/, "")
    .replaceAll(/[-_]/g, "")
    .toLowerCase();
}

const primitiveFiles = new Map<string, Map<string, string>>();

export function primitivesByName(cwd: string, folders: string[]) {
  const key = [cwd, ...folders].join("\n");
  let names = primitiveFiles.get(key);
  if (!names) {
    names = new Map(
      folders
        .flatMap((folder) => sourceFiles(cwd, folder.replace(/\/$/, "")))
        .filter((file) => !TEST_FILE.test(file))
        .map((file) => [componentKey(file), file]),
    );
    names.delete("index");
    primitiveFiles.set(key, names);
  }
  return names;
}
