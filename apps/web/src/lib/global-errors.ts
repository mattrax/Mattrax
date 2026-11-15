import { createSignal } from "solid-js";
import type { RaisedFailure } from "~/lib/errors";

export type GlobalErrorNotice = {
  readonly id: number;
  readonly error: RaisedFailure | undefined;
};

const [globalError, setGlobalError] = createSignal<GlobalErrorNotice | null>(null);
let nextId = 0;

/** Report a failure that a component did not render inline (typically a mutation). */
export const reportGlobalError = (error: RaisedFailure | undefined) => {
  if (error === null || error === undefined) return;
  setGlobalError({ id: nextId++, error });
};

export const dismissGlobalError = () => setGlobalError(null);

export { globalError };
