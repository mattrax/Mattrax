import { getRequestEvent } from "solid-js/web";
import { twMerge } from "tailwind-merge";
import type { ClassValue } from "clsx";
import { clsx } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function localsCache<T>(fn: () => T, s: symbol): () => T {
  return () => (getRequestEvent()!.locals[s] ??= fn());
}
