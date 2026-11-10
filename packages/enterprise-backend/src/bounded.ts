import { Effect } from "effect";

/** Split items into fixed-size chunks without dropping the tail. */
export const chunk = <T>(items: ReadonlyArray<T>, size: number): T[][] => {
  if (!Number.isFinite(size) || size < 1) throw new Error("chunk size must be >= 1");
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    chunks.push(items.slice(index, index + size));
  return chunks;
};

/**
 * Run `work` over every item with bounded concurrency.
 *
 * Chunks are processed in order and each chunk is fanned out with
 * `Effect.forEach`, so at most `concurrency` effects are in flight while results
 * stay in input order. A failing item fails the chunk (callers that need
 * per-item isolation should use `Effect.match`/`catchCause` around the item
 * effect, as the APNs batch does).
 */
export const forEachBounded = <A, E, R>(
  items: ReadonlyArray<A>,
  options: { readonly concurrency: number; readonly chunkSize?: number },
  work: (item: A, index: number) => Effect.Effect<void, E, R>,
): Effect.Effect<void, E, R> => {
  const concurrency = Math.max(1, Math.floor(options.concurrency));
  const chunkSize = Math.max(concurrency, Math.floor(options.chunkSize ?? concurrency * 2));
  return Effect.forEach(
    chunk(items, chunkSize),
    (batch, batchIndex) =>
      Effect.forEach(batch, (item, index) => work(item, batchIndex * chunkSize + index), {
        concurrency,
        discard: true,
      }),
    { discard: true },
  );
};
