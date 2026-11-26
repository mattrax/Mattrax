import { importVisitor } from "../lib/classes.ts";
import { ratcheted } from "../lib/ratchet.ts";

export const oneWayImports = ratcheted<{
  alias?: Record<string, string>;
  layers?: string[];
}>(
  {
    alias: { additionalProperties: { type: "string" }, type: "object" },
    layers: { items: { type: "string" }, type: "array" },
  },
  (
    file,
    {
      alias = { "@/": "src/" },
      layers = ["src/design-system", "src/components", "src/app"],
    },
    report,
  ) => {
    const layerOf = (path: string) =>
      layers.findIndex(
        (layer) => path === layer || path.startsWith(`${layer}/`),
      );
    const from = layerOf(file);
    return importVisitor(file, alias, (target, node) => {
      const to = layerOf(target);
      if (from !== -1 && to > from) {
        report({
          message: `${layers[from]} sits below ${layers[to]} and can't import from it. Pass what this needs through props, or move the file up to ${layers[to]}.`,
          node,
        });
      }
    });
  },
);
