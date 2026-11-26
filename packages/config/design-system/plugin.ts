import { classNamePassthrough } from "./rules/classname-passthrough.ts";
import { closedVariants } from "./rules/closed-variants.ts";
import { completeComposition } from "./rules/complete-composition.ts";
import { iconButtonLabel } from "./rules/icon-button-label.ts";
import { indexInSync } from "./rules/index-in-sync.ts";
import { knownTokens } from "./rules/known-tokens.ts";
import { layoutOnlyClassName } from "./rules/layout-only-classname.ts";
import { noCrossSurfaceImports } from "./rules/no-cross-surface-imports.ts";
import { noDeprecated } from "./rules/no-deprecated.ts";
import { noImportant } from "./rules/no-important.ts";
import { noInlineStyle } from "./rules/no-inline-style.ts";
import { noRawValues } from "./rules/no-raw-values.ts";
import { noTemplateClassname } from "./rules/no-template-classname.ts";
import { noReachInSelectors } from "./rules/no-reach-in-selectors.ts";
import { noRebuiltPrimitives } from "./rules/no-rebuilt-primitives.ts";
import { oneWayImports } from "./rules/one-way-imports.ts";
import { preferShorthand } from "./rules/prefer-shorthand.ts";
import { primitiveNaming } from "./rules/primitive-naming.ts";
import { semanticTokensOnly } from "./rules/semantic-tokens-only.ts";
import { singleExportDefault } from "./rules/single-export-default.ts";
import { noBooleanVariants } from "./rules/no-boolean-variants.ts";
import { noDuplicatePrimitives } from "./rules/no-duplicate-primitives.ts";
import { noThemeOverrides } from "./rules/no-theme-overrides.ts";
import { wrappedLibraries } from "./rules/wrapped-libraries.ts";

const plugin = {
  meta: { name: "design-system" },
  rules: {
    "classname-passthrough": classNamePassthrough,
    "closed-variants": closedVariants,
    "complete-composition": completeComposition,
    "icon-button-label": iconButtonLabel,
    "index-in-sync": indexInSync,
    "known-tokens": knownTokens,
    "layout-only-classname": layoutOnlyClassName,
    "no-cross-surface-imports": noCrossSurfaceImports,
    "no-deprecated": noDeprecated,
    "no-important": noImportant,
    "no-inline-style": noInlineStyle,
    "no-raw-values": noRawValues,
    "no-reach-in-selectors": noReachInSelectors,
    "no-rebuilt-primitives": noRebuiltPrimitives,
    "no-template-classname": noTemplateClassname,
    "one-way-imports": oneWayImports,
    "prefer-shorthand": preferShorthand,
    "primitive-naming": primitiveNaming,
    "semantic-tokens-only": semanticTokensOnly,
    "single-export-default": singleExportDefault,
    "no-boolean-variants": noBooleanVariants,
    "no-duplicate-primitives": noDuplicatePrimitives,
    "no-theme-overrides": noThemeOverrides,
    "wrapped-libraries": wrappedLibraries,
  },
};

export default plugin;
