// Vendored from outtrue (MIT). Kept upstream-compatible.
// oxlint-disable quality/no-known-value-widening, quality/no-unsafe-dictionary-type
import { relative, sep } from "node:path";
import type { Node } from "./ast.ts";
import { missingFolder } from "./paths.ts";

export interface Report {
  message: string;
  node: Node;
}

export interface Context {
  cwd: string;
  filename: string;
  options: unknown[];
  settings?: Record<string, unknown>;
  report: (descriptor: Report) => void;
}

export function relativePath(context: Context) {
  return relative(context.cwd, context.filename).split(sep).join("/");
}

export type Visitor = Record<string, (node: Node) => void>;

function sharedPrimitives(
  context: Context,
  properties: Record<string, unknown>,
) {
  const shared = context.settings?.["design-system"] as
    | { primitives?: string | string[] }
    | undefined;
  if (!(shared?.primitives && "primitives" in properties)) {
    return {};
  }
  const folders = [shared.primitives].flat();
  const takesOne =
    (properties["primitives"] as { type?: string }).type === "string";
  return { primitives: takesOne ? folders[0] : folders };
}

const DEFAULT_ROOT = "src/design-system";

const warned = new Set<string>();

function primitivesWarning(
  cwd: string,
  properties: Record<string, unknown>,
  options: { alias?: Record<string, string>; primitives?: string | string[] },
) {
  if (!("primitives" in properties)) {
    return null;
  }
  const alias = options.alias ?? { "@/": "src/" };
  if (!options.primitives) {
    return missingFolder(cwd, DEFAULT_ROOT, alias)
      ? `No primitives folder is set and ${DEFAULT_ROOT} does not exist, so the rules that check primitives report nothing. Set settings["design-system"].primitives to the folder that holds yours.`
      : null;
  }
  const missing = [options.primitives]
    .flat()
    .map((entry) => missingFolder(cwd, entry, alias))
    .find(Boolean);
  return missing
    ? `primitives is set to ${missing}, which does not exist, so the rules that check primitives report nothing. Point it at the folder that holds yours.`
    : null;
}

export function ratcheted<Options>(
  properties: Record<string, unknown>,
  create: (
    file: string,
    options: Options,
    report: (report: Report) => void,
    cwd: string,
  ) => Visitor,
) {
  return {
    create(context: Context): Visitor {
      const { baseline = {}, ...options } = {
        ...sharedPrimitives(context, properties),
        ...(context.options[0] as object | undefined),
      } as { baseline?: Record<string, number> } & Options;
      const file = relativePath(context);
      const allowance = baseline[file] ?? 0;
      const reports: Report[] = [];
      const visitor = create(
        file,
        options as Options,
        (report) => {
          reports.push(report);
        },
        context.cwd,
      );
      const warning = primitivesWarning(context.cwd, properties, options);
      return {
        ...visitor,
        Program(program) {
          visitor["Program"]?.(program);
          if (warning && !warned.has(warning)) {
            warned.add(warning);
            context.report({ message: warning, node: program });
          }
        },
        "Program:exit"(program) {
          visitor["Program:exit"]?.(program);
          if (reports.length > allowance) {
            for (const report of reports) {
              context.report(report);
            }
          } else if (reports.length < allowance) {
            context.report({
              message: `${file} has ${reports.length} of the ${allowance} violations its baseline allows. Lower the baseline to ${reports.length} so it only shrinks.`,
              node: program,
            });
          }
        },
      };
    },
    meta: {
      schema: [
        {
          additionalProperties: false,
          properties: {
            baseline: {
              additionalProperties: { type: "number" },
              type: "object",
            },
            ...properties,
          },
          type: "object",
        },
      ],
      type: "problem",
    },
  };
}
