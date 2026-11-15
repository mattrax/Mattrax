import { createSignal } from "solid-js";

/**
 * Theme preference and resolution.
 *
 * The dashboard supports `system`, `light` and `dark`. The preference is stored
 * per account on this device (`mattrax:theme:<userId>`) with a device-wide
 * fallback (`mattrax:theme`) so pre-auth pages and the first paint agree. The
 * resolved theme is applied to `<html class="dark">`, `color-scheme` and the
 * `theme-color` meta before the browser paints (see `Document.tsx`), and kept in
 * sync with the OS while the preference is `system`.
 *
 * This module is imported by the browser only; every function tolerates a
 * missing `window` so the server document can import the constants.
 */
export type ThemePreference = "system" | "light" | "dark";

export type ResolvedTheme = "light" | "dark";

/** Device-wide preference, used before a user is known and by public pages. */
export const THEME_STORAGE_KEY = "mattrax:theme";

/** `theme-color` per resolved theme. Keep in sync with `apps/web/src/Document.tsx`. */
export const THEME_COLOURS = {
  light: "#ffffff",
  dark: "#08080a",
} as const;

export const THEME_PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark"];

/** Per-account key; the browser shell has the user id before hydration. */
export const userThemeKey = (userId: string) => `${THEME_STORAGE_KEY}:${userId}`;

export const parseThemePreference = (
  value: string | null | undefined,
): ThemePreference | undefined =>
  value === "system" || value === "light" || value === "dark" ? value : undefined;

/** Resolve a preference against the OS setting. */
export const resolveTheme = (
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme => (preference === "system" ? (systemPrefersDark ? "dark" : "light") : preference);

const localStorageOrUndefined = (): Storage | undefined => {
  if (typeof localStorage === "undefined") return undefined;

  try {
    return localStorage;
  } catch {
    // Safari with cookies blocked throws on access; the theme still works for
    // this page load, it just is not remembered.
    return undefined;
  }
};

/**
 * Read the effective preference. A signed-in user's own choice wins; otherwise
 * the device default applies, then `system`.
 */
export const readThemePreference = (userId?: string): ThemePreference => {
  const store = localStorageOrUndefined();

  if (!store) return "system";

  const scoped = userId ? parseThemePreference(store.getItem(userThemeKey(userId))) : undefined;

  return scoped ?? parseThemePreference(store.getItem(THEME_STORAGE_KEY)) ?? "system";
};

/**
 * Persist the preference. The device key always follows so the landing page and
 * the pre-auth shell paint the same theme as the account that last used it.
 */
export const writeThemePreference = (preference: ThemePreference, userId?: string): void => {
  const store = localStorageOrUndefined();

  if (!store) return;

  try {
    store.setItem(THEME_STORAGE_KEY, preference);

    if (userId) store.setItem(userThemeKey(userId), preference);
  } catch {
    // Storage can be full or read-only. Losing persistence must not break the
    // control; the in-memory signal still repaints this tab.
  }
};

const systemPrefersDark = (): boolean =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-color-scheme: dark)").matches === true;

/** Apply a resolved theme to the document element without a repaint race. */
export const applyTheme = (theme: ResolvedTheme, root?: HTMLElement): void => {
  const element = root ?? (typeof document === "undefined" ? undefined : document.documentElement);

  if (!element) return;

  element.classList.toggle("dark", theme === "dark");
  element.dataset.theme = theme;
  element.style.colorScheme = theme;

  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'))
    meta.content = THEME_COLOURS[theme];
};

const [themePreference, setThemePreferenceSignal] = createSignal<ThemePreference>("system");
const [resolvedTheme, setResolvedThemeSignal] = createSignal<ResolvedTheme>("light");

export { themePreference, resolvedTheme };

let installedFor: string | undefined;
let teardown: (() => void) | undefined;

/**
 * Start tracking the preference for `userId` (or anonymously when undefined).
 *
 * Idempotent: the dashboard calls it with the signed-in user after hydration;
 * public pages call it once without an id. Returns nothing because the module is
 * a singleton — `installTheme` owns its own listeners.
 */
export const installTheme = (userId?: string): void => {
  if (typeof window === "undefined") return;

  const marker = userId ?? "";
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");

  const publish = () => {
    const preference = readThemePreference(userId);
    const theme = resolveTheme(preference, systemPrefersDark());

    setThemePreferenceSignal(preference);
    setResolvedThemeSignal(theme);
    applyTheme(theme);
  };

  // Re-installing for a different account swaps the storage scope. Listeners
  // from the previous account are removed first so a stale user id cannot win.
  if (installedFor === marker) {
    publish();

    return;
  }

  teardown?.();
  teardown = undefined;
  installedFor = marker;
  publish();

  const onSystemChange = () => {
    if (readThemePreference(userId) !== "system") return;

    publish();
  };

  // Another tab changed the theme: follow it without a round trip.
  const onStorage = (event: StorageEvent) => {
    if (
      event.key !== THEME_STORAGE_KEY &&
      event.key !== (userId ? userThemeKey(userId) : undefined)
    )
      return;

    publish();
  };

  media?.addEventListener("change", onSystemChange);
  window.addEventListener("storage", onStorage);

  teardown = () => {
    media?.removeEventListener("change", onSystemChange);
    window.removeEventListener("storage", onStorage);
    teardown = undefined;
    installedFor = undefined;
  };
};

/** Change the preference for this account and repaint immediately. */
export const setThemePreference = (preference: ThemePreference, userId?: string): void => {
  writeThemePreference(preference, userId);
  installTheme(userId);
};

/**
 * The blocking script that resolves the theme before first paint.
 *
 * It reads storage synchronously (the only way to avoid a flash), falls back to
 * `system`, and updates `class`, `color-scheme` and the `theme-color` meta. It is
 * emitted inline in `<head>` ahead of the hydration bundle.
 */
export const themeBootstrapScript = (userId?: string): string => {
  const scopedKey = JSON.stringify(userId ? userThemeKey(userId) : null);
  const deviceKey = JSON.stringify(THEME_STORAGE_KEY);
  const colours = JSON.stringify(THEME_COLOURS);

  return `(function(){try{
var root=document.documentElement,store=window.localStorage,meta=document.querySelector('meta[name="theme-color"]'),colours=${colours};
var scoped=${scopedKey};
var stored=(scoped?store.getItem(scoped):null)||store.getItem(${deviceKey})||"system";
var preference=stored==="light"||stored==="dark"?stored:"system";
var dark=preference==="dark"||(preference==="system"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);
var theme=dark?"dark":"light";
root.classList.toggle("dark",dark);
root.dataset.theme=theme;
root.style.colorScheme=theme;
if(meta)meta.setAttribute("content",colours[theme]);
}catch(error){document.documentElement.classList.remove("dark");}})();`;
};
