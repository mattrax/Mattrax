type GlobalKey = string;

/**
 * Replace a global for the duration of a test and return a restore function.
 * Replaces vi.stubGlobal / vi.unstubAllGlobals without the mocking API.
 */
export const installGlobal = <V>(key: GlobalKey, replacement: V): (() => void) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, key);

  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: replacement,
  });

  return () => {
    if (previous) Object.defineProperty(globalThis, key, previous);
    else Reflect.deleteProperty(globalThis, key);
  };
};

/** Install several globals at once; call the returned function in afterEach. */
export const installGlobals = <V>(values: Record<GlobalKey, V>): (() => void) => {
  const restores = Object.entries(values).map(([key, value]) => installGlobal(key, value));

  return () => {
    for (const restore of restores.reverse()) restore();
  };
};
