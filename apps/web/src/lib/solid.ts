import { merge, omit } from "solid-js";

/**
 * Solid 1 compatibility helpers.
 *
 * Solid 2 replaced `mergeProps`/`splitProps` with the reactive `merge`/`omit`
 * views. The generated UI components still use the 1.x names, so keep the
 * shape while delegating to the runtime primitives.
 */
export function mergeProps<T extends Record<string, any>[]>(
  ...sources: T
): ReturnType<typeof merge<T>> {
  return merge(...sources);
}

export function splitProps<T extends Record<string, any>, K extends keyof T>(
  props: T,
  keys: readonly K[],
): [Pick<T, K>, Omit<T, K>] {
  const picked = {} as Pick<T, K>;

  for (const key of keys) {
    Object.defineProperty(picked, key, {
      enumerable: true,
      configurable: true,
      get: () => props[key],
    });
  }

  return [picked, omit(props, ...keys) as unknown as Omit<T, K>];
}
