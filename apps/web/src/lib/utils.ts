import { getRequestEvent } from "solid-js/web";
import { twMerge } from "tailwind-merge";
import type { ClassValue } from "clsx";
import { clsx } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function localsCache<T>(fn: () => T, s: symbol): () => T {
  // when not running in cloudfalre
  if (import.meta.env.DEV) {
    let value: T | undefined;

    return () => {
      value ??= fn();
      return value;
    };
  }

  return () => {
    const e = getRequestEvent();
    // We are running db:gen
    if (!e) return fn();
    // biome-ignore lint/suspicious/noAssignInExpressions:
    return (e.locals[s] ??= fn());
  };
}
