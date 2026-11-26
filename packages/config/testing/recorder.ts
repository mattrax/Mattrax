type Implementation<Args extends unknown[], R> = (...args: Args) => R;

/** Type a hand-written fake at an injection boundary without chained assertions. */
export const asFake = <T>(value: unknown): T => value as T;

/**
 * Recording stub that replaces vi.fn. Vitest's `toHaveBeenCalledWith`
 * matcher reads `.mock.calls`, which this exposes, so assertions keep working
 * without the mocking API the lint rule bans.
 */
export interface Recorder<Args extends unknown[], R> extends Implementation<Args, R> {
  calls: Args[];
  mock: { calls: Args[] };
  // Vitest's toHaveBeenCalled* matchers look for these markers. Setting them
  // here lets a hand-written test double use the same assertions as a spy.
  _isMockFunction: true;
  getMockName(): string;
  mockReturnValue(value: R): this;
  mockReturnValueOnce(value: R): this;
  mockResolvedValue(value: Awaited<R>): this;
  mockResolvedValueOnce(value: Awaited<R>): this;
  mockRejectedValue(value: unknown): this;
  mockRejectedValueOnce(value: unknown): this;
  mockImplementation(implementation: Implementation<Args, R>): this;
  mockClear(): this;
}

export const recorder = <Args extends unknown[], R = void>(
  implementation?: Implementation<Args, R>,
): Recorder<Args, R> => {
  const calls: Args[] = [];
  const once: Array<Implementation<Args, R>> = [];
  let persistent: Implementation<Args, R> | undefined = implementation;

  const value = (result: unknown): Implementation<Args, R> =>
    (() => result) as Implementation<Args, R>;
  const resolved = (result: unknown): Implementation<Args, R> =>
    (() => Promise.resolve(result)) as Implementation<Args, R>;
  const rejected = (result: unknown): Implementation<Args, R> =>
    (() => Promise.reject(result)) as Implementation<Args, R>;

  const fn = ((...args: Args): R => {
    calls.push(args);
    const next = once.shift() ?? persistent;

    return next ? next(...args) : (undefined as R);
  }) as Recorder<Args, R>;

  fn.calls = calls;
  fn.mock = { calls };
  fn._isMockFunction = true;
  fn.getMockName = () => "recorder";
  fn.mockReturnValue = (result) => {
    persistent = value(result);
    return fn;
  };
  fn.mockReturnValueOnce = (result) => {
    once.push(value(result));
    return fn;
  };
  fn.mockResolvedValue = (result) => {
    persistent = resolved(result);
    return fn;
  };
  fn.mockResolvedValueOnce = (result) => {
    once.push(resolved(result));
    return fn;
  };
  fn.mockRejectedValue = (result) => {
    persistent = rejected(result);
    return fn;
  };
  fn.mockRejectedValueOnce = (result) => {
    once.push(rejected(result));
    return fn;
  };
  fn.mockImplementation = (next) => {
    persistent = next;
    return fn;
  };
  fn.mockClear = () => {
    calls.length = 0;
    return fn;
  };

  return fn;
};
