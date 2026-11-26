// Vendored from outtrue (MIT). Kept upstream-compatible.
// oxlint-disable unicorn/prefer-string-raw
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import type { Node } from "../lib/ast.ts";
import { isUnder, SOURCE_FILE, sourceFiles } from "../lib/paths.ts";
import { ratcheted } from "../lib/ratchet.ts";
import type { Visitor } from "../lib/ratchet.ts";

function pascalCase(name: string) {
  return name
    .split(/[-_.]/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("");
}

function mentions(text: string, name: string) {
  const escaped = name.replaceAll(/[$()*+.?[\\\]^{|}]/g, "\\$&");
  return new RegExp(
    `^\\s*[-*]\\s+(?:\\*\\*|__)?${escaped}[^\\w-]|\`(?:[\\w@.-]+/)*${escaped}(?:\\.[jt]sx?)?\``,
    "im",
  ).test(text);
}

const INDEX_ENTRY = /^\s*[-*]\s+[\w<*][^:`]*:\s.*`([\w@./-]+)`\s*$/;

const indexes = new Map<string, string>();

function readIndex(cwd: string, index: string, primitives: string[]) {
  const path = join(cwd, index);
  const files = primitives.flatMap((folder) => sourceFiles(cwd, folder));
  if (!existsSync(path)) {
    return { files, text: null };
  }
  const key = `${path}:${statSync(path).mtimeMs}`;
  const text = indexes.get(key) ?? readFileSync(path, "utf8");
  indexes.set(key, text);
  return { files, text };
}

export const indexInSync = ratcheted<{
  ignore?: string[];
  index?: string;
  primitives?: string[];
}>(
  {
    ignore: { items: { type: "string" }, type: "array" },
    index: { type: "string" },
    primitives: { items: { type: "string" }, type: "array" },
  },
  (
    file,
    {
      ignore = ["\\.(?:test|spec|stories)\\.", "(?:^|/)index\\.[jt]sx?$"],
      index = "src/design-system/INDEX.md",
      primitives = ["src/design-system/components"],
    },
    report,
    cwd,
  ): Visitor => {
    if (!isUnder(file, primitives)) {
      return {};
    }
    const ignored = ignore.map((pattern) => new RegExp(pattern));
    const isListed = (path: string) =>
      !ignored.some((pattern) => pattern.test(path));
    return {
      Program(program: Node) {
        if (!isListed(file)) {
          return;
        }
        const read = readIndex(cwd, index, primitives);
        const files = read.files.filter(isListed);
        const isFirst = files[0] === file;
        const { text } = read;
        if (text === null) {
          if (isFirst) {
            report({
              message: `${index} does not exist. Create it with one line per component.`,
              node: program,
            });
          }
          return;
        }
        const stem = file.replace(SOURCE_FILE, "");
        const base = posix.basename(stem);
        if (!(mentions(text, base) || mentions(text, pascalCase(base)))) {
          report({
            message: `${base} has no line in ${index}. Add a line that names it and says what it is for.`,
            node: program,
          });
        }
        if (!isFirst) {
          return;
        }
        const names = new Set(
          files.map((candidate) =>
            posix.basename(candidate.replace(SOURCE_FILE, "")),
          ),
        );
        for (const line of text.split("\n")) {
          const entry = INDEX_ENTRY.exec(line)?.[1];
          if (entry && !names.has(posix.basename(entry))) {
            report({
              message: `${index} lists ${entry} and no component file matches it. Remove the line or fix the path.`,
              node: program,
            });
          }
        }
      },
    };
  },
);
