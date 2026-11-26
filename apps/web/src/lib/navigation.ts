import { useNavigate as useRouterNavigate } from "@solidjs/router";
import type { NavigateOptions, Navigator, TypedPath } from "@solidjs/router";
import { createContext, useContext } from "solid-js";

/**
 * Injectable navigator. Solid Router's `useNavigate` needs a Router root, so
 * screens rendered in isolation (tests, design previews) provide a navigator
 * here instead of replacing the module.
 */
export const NavigateContext = createContext<Navigator>();

/**
 * Programmatic navigation that survives a same-tick state write.
 *
 * Solid Router 2 starts navigations as transitions. A navigation issued while
 * another render/transition (or a query-cache write) is still settling is
 * dropped, leaving the URL on the previous page without an error. Deferring one
 * macrotask lets the pending write commit first. Relative history moves (`-1`)
 * are synchronous because they are not transitions.
 */
export function useNavigate(): ReturnType<typeof useRouterNavigate> {
  // Only reach for the Router when nothing was injected; the context lookup is
  // safe outside a Router, so isolated screens can supply their own navigator.
  const injected = useContext(NavigateContext);
  const navigate = injected ?? useRouterNavigate();

  const isDelta = (value: string | TypedPath | number): value is number =>
    typeof value === "number";

  function deferred(to: string | TypedPath | number, options?: Partial<NavigateOptions>): void;
  function deferred(delta: number): void;

  function deferred(to: string | TypedPath | number, options?: Partial<NavigateOptions>): void {
    if (isDelta(to)) {
      navigate(to);

      return;
    }

    setTimeout(() => navigate(to, options), 0);
  }

  const result: Navigator = deferred;

  return result;
}
