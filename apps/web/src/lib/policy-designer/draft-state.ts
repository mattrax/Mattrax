import { PLATFORM_ORDER } from "./build";
import type { PolicyDraft, Selection } from "./build";
import type { CollectionSummary, PlatformId } from "./catalog";

/**
 * A stable serialization of the parts of a draft an administrator edits.
 *
 * The designer compares snapshots to decide whether leaving the page would
 * discard work. `savedAt` is deliberately excluded: it is metadata written by
 * autosave and by the server, not an edit. Empty platforms are excluded too so
 * a draft loaded from a different shape does not look dirty.
 */
export const policyDraftSnapshot = (policy: PolicyDraft): string => {
  const platforms: Array<[PlatformId, Selection[]]> = PLATFORM_ORDER.map((platform) => [
    platform,
    policy.platforms[platform] ?? [],
  ]);

  return JSON.stringify({
    name: policy.name,
    platforms: platforms.filter(([, selections]) => selections.length > 0),
  });
};

/** Whether the current draft differs from the last state we consider saved. */
export const isPolicyDraftDirty = (policy: PolicyDraft, savedSnapshot: string): boolean =>
  policyDraftSnapshot(policy) !== savedSnapshot;

/**
 * The baseline is the server's persisted draft, not a newer browser autosave.
 * Falling back to the local draft only matters for the public designer, which
 * has no server copy yet.
 */
export const seedPolicyDraftBaseline = (input: {
  persistedDraft?: PolicyDraft;
  initialDraft?: PolicyDraft;
  currentDraft: PolicyDraft;
}): PolicyDraft => input.persistedDraft ?? input.initialDraft ?? input.currentDraft;

export type NormalisedSelectionIds = {
  readonly selections: Selection[];
  readonly rewrites: Map<string, string>;
};

/**
 * Rewrite legacy `apple:<identifier>` selection ids to the catalogue key used
 * by current builds. Returns the rewritten selections and the old-to-new id map
 * so the saved baseline can receive the same rewrite without becoming dirty.
 */
export const normaliseSelectionCollectionIds = (
  selections: ReadonlyArray<Selection>,
  collections: ReadonlyArray<CollectionSummary>,
): NormalisedSelectionIds => {
  const rewrites = new Map<string, string>();

  const normalised = selections.map((selection) => {
    if (
      collections.some(
        (collection) => `${collection.id}#${collection.name}` === selection.collectionId,
      )
    )
      return selection;

    const match =
      collections.find(
        (collection) =>
          collection.identifier === selection.identifier && collection.name === selection.name,
      ) ?? collections.find((collection) => collection.identifier === selection.identifier);

    if (!match) return selection;

    const collectionId = `${match.id}#${match.name}`;
    rewrites.set(selection.collectionId, collectionId);

    return { ...selection, collectionId };
  });

  return { selections: normalised, rewrites };
};

/** Apply id rewrites to one platform of a saved draft, leaving its values alone. */
export const applyCollectionIdRewrites = (
  draft: PolicyDraft,
  platform: PlatformId,
  rewrites: ReadonlyMap<string, string>,
): PolicyDraft => {
  if (rewrites.size === 0) return draft;

  const selections = draft.platforms[platform];

  if (!selections) return draft;

  const next = selections.map((selection) => {
    const collectionId = rewrites.get(selection.collectionId);

    return collectionId ? { ...selection, collectionId } : selection;
  });

  return { ...draft, platforms: { ...draft.platforms, [platform]: next } };
};
