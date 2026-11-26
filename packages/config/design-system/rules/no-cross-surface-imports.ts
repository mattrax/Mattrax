import { importVisitor } from "../lib/classes.ts";
import { ratcheted } from "../lib/ratchet.ts";

export const noCrossSurfaceImports = ratcheted<{
  alias?: Record<string, string>;
  primitives?: string;
  shared?: string[];
  surfaces?: string[];
}>(
  {
    alias: { additionalProperties: { type: "string" }, type: "object" },
    primitives: { type: "string" },
    shared: { items: { type: "string" }, type: "array" },
    surfaces: { items: { type: "string" }, type: "array" },
  },
  (
    file,
    {
      alias = { "@/": "src/" },
      primitives = "src/design-system/components",
      shared = [],
      surfaces = ["src/components"],
    },
    report,
  ) => {
    const surfaceOf = (path: string) => {
      if (path === primitives || path.startsWith(`${primitives}/`)) {
        return null;
      }
      for (const folder of surfaces) {
        if (path.startsWith(`${folder}/`)) {
          const [surface = "", ...rest] = path
            .slice(folder.length + 1)
            .split("/");
          return rest.length > 0 ? surface : null;
        }
      }
      return null;
    };
    const from = surfaceOf(file);
    return importVisitor(file, alias, (target, node) => {
      const to = surfaceOf(target);
      if (from && to && to !== from && !shared.includes(to)) {
        report({
          message: `${from} imports from ${to}. A component two parts of the product use belongs to the design system. Move it to ${primitives}, or pass it in through props.`,
          node,
        });
      }
    });
  },
);
