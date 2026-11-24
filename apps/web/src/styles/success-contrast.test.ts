import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const repository = join(import.meta.dirname, "../../../..");
const styles = readFileSync(join(repository, "packages/ui/src/styles.css"), "utf8");

const themeTokens = (selector: RegExp) => {
  const block = styles.match(selector)?.[1];

  if (!block) throw new Error(`Missing theme block: ${selector}`);

  const token = (name: string) => {
    const pattern = new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i");
    const value = block.match(pattern)?.[1];

    if (!value) throw new Error(`Missing --${name} in ${selector}`);

    return value;
  };

  return {
    success: token("success"),
    successForeground: token("success-foreground"),
    card: token("card"),
    page: token("page"),
  };
};

const rgb = (hex: string) =>
  hex
    .slice(1)
    .match(/.{2}/g)!
    .map((channel) => Number.parseInt(channel, 16));

const luminance = (hex: string) => {
  const [red, green, blue] = rgb(hex).map((channel) => {
    const value = channel / 255;

    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });

  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
};

const contrast = (foreground: string, background: string) => {
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);

  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
};

const blend = (foreground: string, background: string, alpha: number) => {
  const foregroundRgb = rgb(foreground);
  const backgroundRgb = rgb(background);
  const channels = foregroundRgb.map((channel, index) =>
    Math.round(channel * alpha + backgroundRgb[index] * (1 - alpha)),
  );

  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
};

const themes = {
  light: themeTokens(/:root,\s*\.theme-light\s*\{([\s\S]*?)\n\}/),
  dark: themeTokens(/\.dark\s*\{([\s\S]*?)\n\}/),
};

describe("success badge contrast", () => {
  for (const [theme, tokens] of Object.entries(themes)) {
    test(`${theme} success text meets AA on tinted card and page surfaces`, () => {
      for (const surface of [tokens.card, tokens.page]) {
        const tint = blend(tokens.success, surface, 0.1);

        expect(
          contrast(tokens.success, tint),
          `${theme}: ${tokens.success} on ${tint}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });

    test(`${theme} solid success fills keep their foreground readable`, () => {
      expect(contrast(tokens.successForeground, tokens.success)).toBeGreaterThanOrEqual(4.5);
    });
  }

  test("tinted success badges use the tone token, not the solid-fill foreground", () => {
    const source = (path: string) => readFileSync(join(repository, path), "utf8");
    const users = source("apps/web/src/routes/(dashboard)/t/[tenantId]/users/index.tsx");
    const account = source("apps/web/src/routes/(dashboard)/account/index.tsx");
    const statusChip = source("apps/web/src/components/settings/status-chip.tsx");

    expect(users).toContain("bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success");
    expect(users).not.toContain(
      "bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success-foreground",
    );
    expect(account).not.toContain("text-success-foreground");
    expect(statusChip).toContain('success: "border-success/25 bg-success/10 text-success"');
  });
});
