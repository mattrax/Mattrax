import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * The globe encodes land, water and coastlines with colour tokens. Keep the
 * pairs at WCAG's 3:1 non-text contrast minimum in both themes: an outline that
 * disappears into the ocean is not a border, and land that matches water is not
 * a map.
 */
const css = readFileSync(
  join(import.meta.dirname, "../../../../packages/ui/src/styles.css"),
  "utf8",
);

const darkStart = css.indexOf(".dark {");
const light = css.slice(0, darkStart);
const dark = css.slice(darkStart);

const token = (block: string, name: string) => {
  const match = block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));

  if (!match?.[1]) throw new Error(`Missing --${name}`);

  return match[1];
};

const luminance = (hex: string) => {
  const channels = hex
    .replace("#", "")
    .match(/../g)!
    .map((part) => Number.parseInt(part, 16) / 255)
    .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));

  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
};

const contrast = (left: string, right: string) => {
  const a = luminance(left);
  const b = luminance(right);

  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

for (const [theme, block] of [
  ["light", light],
  ["dark", dark],
] as const) {
  test(`${theme} globe colours meet 3:1`, () => {
    const ocean = token(block, "globe-ocean");
    const land = token(block, "globe-land");
    const coast = token(block, "globe-land-stroke");

    expect(contrast(land, ocean)).toBeGreaterThanOrEqual(3);
    expect(contrast(coast, land)).toBeGreaterThanOrEqual(3);
    expect(contrast(coast, ocean)).toBeGreaterThanOrEqual(3);
  });
}

describe("globe palette scope", () => {
  test("keeps globe tokens out of the general colour API", () => {
    expect(css.match(/--globe-/g)?.length).toBe(6);
  });
});
