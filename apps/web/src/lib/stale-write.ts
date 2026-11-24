import { createEffect, createSignal } from "solid-js";
import { errorTag, raisedFailure } from "~/lib/errors";
import type { RaisedFailure } from "~/lib/errors";

/** Shown when a guarded mutation loses the optimistic-concurrency race. */
export const STALE_WRITE_TITLE = "Someone else changed this; reloading the latest version";

export const STALE_WRITE_DESCRIPTION =
  "Your unsaved changes are kept. Review the latest version before saving again.";

/**
 * Was this failure the endpoint's 412 precondition check?
 *
 * The API returns `EnterprisePreconditionFailed`; transports wrap it in an
 * envelope, so this uses the same tag extraction as every other API error.
 */
export const isStaleWriteError = (error: RaisedFailure | undefined): boolean =>
  errorTag(raisedFailure(error)) === "EnterprisePreconditionFailed";

export type StaleWriteOptions = {
  /** Refetch or invalidate the record so the page holds the latest version. */
  // oxlint-disable-next-line quality/no-unknown-returns -- the reload result is discarded.
  readonly reload: () => void | Promise<unknown>;
  /**
   * Notification sink. Components pass the dashboard toast through
   * `handleStaleWriteWithToast`; keeping it injected leaves this module free
   * of the DOM and testable with a spy.
   */
  readonly notify: (title: string, options?: { description?: string }) => void;
};

/**
 * Handle a 412 without losing the operator's input: announce the conflict,
 * refresh the cached record, and let the caller keep its draft.
 *
 * Returns `false` for every other error so callers can keep their existing
 * failure path.
 */
export const handleStaleWrite = (
  error: RaisedFailure | undefined,
  options: StaleWriteOptions,
): boolean => {
  if (!isStaleWriteError(error)) return false;

  options.notify(STALE_WRITE_TITLE, { description: STALE_WRITE_DESCRIPTION });

  // Refreshing must never replace the draft, so failures are left to the
  // query layer's own error surface.
  void options.reload();

  return true;
};

export type StaleWriteGuard = {
  /** The version the open editor is based on; send with every save. */
  readonly expectedUpdatedAt: () => string | undefined;
  /** True after a 412 until the operator reloads or accepts the latest. */
  readonly conflict: () => boolean;
  /** The save failed its precondition. */
  readonly markConflict: () => void;
  /** The save succeeded; future refetches may move the base forward again. */
  readonly markSaved: () => void;
  /**
   * Acknowledge a server-side refresh that advanced `updatedAt` while the
   * editor kept its draft. A forced 412 remains pinned until the operator
   * explicitly accepts the latest version.
   */
  readonly markRefreshed: () => void;
  /**
   * Accept the refetched version as the new base. Callers keep their draft,
   * so this is the explicit "save mine over it" action.
   */
  readonly acceptLatest: () => void;
};

/**
 * Pin the `updatedAt` an editor loaded.
 *
 * While a conflict is unresolved the base deliberately does not follow the
 * refetched row. Otherwise the next save would quietly succeed using the
 * other administrator's version, overwriting their change with a draft that
 * never included it.
 */
export const createStaleWriteGuard = (
  currentUpdatedAt: () => string | undefined,
): StaleWriteGuard => {
  const [base, setBase] = createSignal<string | undefined>(currentUpdatedAt());
  const [conflict, setConflict] = createSignal(false);

  // Set after our own save so the next refetched timestamp becomes the base.
  // Reading it untracked keeps `markSaved` from pinning the old value before
  // the invalidation has fetched the new one.
  let pendingResync = false;

  createEffect(
    () => currentUpdatedAt(),
    (updatedAt) => {
      if (!updatedAt) return;

      if (base() !== undefined && !pendingResync) return;

      pendingResync = false;
      setBase(updatedAt);
    },
  );

  return {
    expectedUpdatedAt: base,
    conflict,
    markConflict: () => {
      pendingResync = false;
      setConflict(true);
    },
    markSaved: () => {
      pendingResync = true;
      setConflict(false);
    },
    markRefreshed: () => {
      if (conflict()) return;

      pendingResync = false;
      const updatedAt = currentUpdatedAt();

      if (updatedAt !== undefined) setBase(updatedAt);
    },
    acceptLatest: () => {
      pendingResync = false;
      setConflict(false);
      setBase(currentUpdatedAt());
    },
  };
};
