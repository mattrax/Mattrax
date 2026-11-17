import { describe, expect, test, vi } from "vitest";
import {
  parseThemePreference,
  readThemePreference,
  resolveTheme,
  THEME_COLOURS,
  themeBootstrapScript,
  userThemeKey,
  writeThemePreference,
} from "./theme";

const fakeStorage = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial));

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    value: (key: string) => values.get(key) ?? null,
  };
};

describe("theme preference", () => {
  test("only the three documented values decode", () => {
    expect(parseThemePreference("system")).toBe("system");
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("")).toBeUndefined();
    expect(parseThemePreference(null)).toBeUndefined();
    expect(parseThemePreference("Dark")).toBeUndefined();
  });

  test("system resolves against the OS setting and explicit choices ignore it", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  test("the account choice wins over the device default", () => {
    vi.stubGlobal("localStorage", fakeStorage());

    try {
      writeThemePreference("dark");
      expect(readThemePreference()).toBe("dark");

      writeThemePreference("light", "user-1");
      expect(readThemePreference("user-1")).toBe("light");
      // The device key follows the last choice so pre-auth pages match; an
      // account without its own entry inherits it.
      expect(readThemePreference("user-2")).toBe("light");

      writeThemePreference("system", "user-2");
      expect(readThemePreference("user-2")).toBe("system");
      expect(readThemePreference()).toBe("system");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("theme colours match the documented paper colours", () => {
    expect(THEME_COLOURS.light).toBe("#f6f6f3");
    expect(THEME_COLOURS.dark).toBe("#10100f");
  });
});

describe("pre-hydration bootstrap", () => {
  const run = (
    userId: string | undefined,
    stored: Record<string, string> = {},
    prefersDark = false,
  ) => {
    const classes = new Set<string>();
    const dataset: Record<string, string> = {};
    const style: Record<string, string> = {};
    let metaContent = "";

    const document = {
      documentElement: {
        classList: {
          toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)),
          remove: (name: string) => classes.delete(name),
        },
        dataset,
        style,
      },
      querySelector: () => ({ setAttribute: (_: string, value: string) => (metaContent = value) }),
    };

    const window = {
      localStorage: { getItem: (key: string) => stored[key] ?? null },
      matchMedia: () => ({ matches: prefersDark }),
    };

    // The script is emitted inline, so exercising it here proves it parses and
    // that the values it reads are the ones the app writes.
    // SAFETY: the script takes `document` and `window` as its only globals.
    new Function("document", "window", themeBootstrapScript(userId))(document, window);

    return {
      dark: classes.has("dark"),
      theme: dataset.theme,
      colorScheme: style.colorScheme,
      metaContent,
    };
  };

  test("a scoped dark choice applies before paint", () => {
    const result = run("user-1", { [userThemeKey("user-1")]: "dark" });

    expect(result.dark).toBe(true);
    expect(result.theme).toBe("dark");
    expect(result.colorScheme).toBe("dark");
    expect(result.metaContent).toBe(THEME_COLOURS.dark);
  });

  test("a scoped light choice beats a dark device default", () => {
    const result = run(
      "user-2",
      { [userThemeKey("user-2")]: "light", "mattrax:theme": "dark" },
      true,
    );

    expect(result.dark).toBe(false);
    expect(result.theme).toBe("light");
    expect(result.metaContent).toBe(THEME_COLOURS.light);
  });

  test("system follows the OS preference", () => {
    expect(run(undefined, {}, true).theme).toBe("dark");
    expect(run(undefined, {}, false).theme).toBe("light");
  });

  test("a corrupt stored value falls back to system", () => {
    const result = run(undefined, { "mattrax:theme": "neon" }, true);

    expect(result.theme).toBe("dark");
  });
});
