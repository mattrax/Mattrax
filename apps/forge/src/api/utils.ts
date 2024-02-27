export type PromiseValues<TO> = {
  [TK in keyof TO]: Promise<TO[TK]>;
};

export const promiseAllObject = <T>(obj: PromiseValues<T>): Promise<T> => {
  return Promise.all(
    Object.entries(obj).map(async ([k, v]) => [k, await v])
  ).then(Object.fromEntries);
};
