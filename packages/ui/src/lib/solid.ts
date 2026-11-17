import { merge, omit } from "solid-js";

/**
 * Solid 1 compatibility helpers.
 *
 * Solid 2 replaced `mergeProps`/`splitProps` with the reactive `merge`/`omit`
 * views. These wrappers keep the 1.x names for component code.
 */
export function mergeProps<T extends object[]>(...sources: T): ReturnType<typeof merge<T>> {
  return merge(...sources);
}

export function splitProps<T extends object, K extends keyof T>(
  props: T,
  keys: readonly K[],
): [Pick<T, K>, Omit<T, K>] {
  // SAFETY: every key in `keys` is defined as a reactive getter on `picked`
  // before the object is returned.
  const picked = {} as Pick<T, K>;

  for (const key of keys) {
    Object.defineProperty(picked, key, {
      enumerable: true,
      configurable: true,
      get: () => props[key],
    });
  }

  const rest: unknown = omit(props, ...keys);

  // SAFETY: `omit` returns the props without `keys`; only its generic signature
  // names the key array (`K[]`) rather than the union of those keys.
  return [picked, rest as Omit<T, K>];
}
