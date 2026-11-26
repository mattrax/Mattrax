import { describe, expect, it } from "vitest";
import { emptyPolicyDraft } from "./build";
import type { PolicyDraft, Selection } from "./build";
import type { CollectionSummary } from "./catalog";
import {
  applyCollectionIdRewrites,
  isPolicyDraftDirty,
  normaliseSelectionCollectionIds,
  policyDraftSnapshot,
  seedPolicyDraftBaseline,
} from "./draft-state";

/** Fixed timestamp for autosave metadata fixtures. */
const NOW = Date.parse("2026-06-01T12:00:00.000Z");

const selection = (identifier: string, values: Record<string, string> = {}): Selection => ({
  collectionId: `apple/profiles/${identifier}`,
  identifier,
  kind: "profile",
  surface: "profile",
  name: identifier,
  properties: [],
  values,
});

const withSelection = (draft: PolicyDraft, value: Selection): PolicyDraft => ({
  ...draft,
  platforms: { ...draft.platforms, apple: [...(draft.platforms.apple ?? []), value] },
});

describe("policy draft saved state", () => {
  it("treats a draft that has just loaded as clean", () => {
    const draft = withSelection(emptyPolicyDraft("Baseline"), selection("wifi"));
    const saved = policyDraftSnapshot(draft);

    expect(isPolicyDraftDirty(draft, saved)).toBe(false);
  });

  it("reports an edited draft as dirty", () => {
    const draft = withSelection(emptyPolicyDraft("Baseline"), selection("wifi"));
    const saved = policyDraftSnapshot(draft);

    expect(isPolicyDraftDirty({ ...draft, name: "Baseline v2" }, saved)).toBe(true);
    expect(isPolicyDraftDirty(withSelection(draft, selection("vpn")), saved)).toBe(true);

    const changedValue = withSelection(
      emptyPolicyDraft("Baseline"),
      selection("wifi", { ssid: "Corp" }),
    );

    expect(isPolicyDraftDirty(changedValue, saved)).toBe(true);
  });

  it("becomes clean again once the edited draft is saved", () => {
    const initial = withSelection(emptyPolicyDraft("Baseline"), selection("wifi"));
    const edited = withSelection(initial, selection("vpn"));
    const saved = policyDraftSnapshot(edited);

    expect(isPolicyDraftDirty(edited, saved)).toBe(false);
  });

  it("reports edits made after a save", () => {
    const initial = withSelection(emptyPolicyDraft("Baseline"), selection("wifi"));
    const savedSnapshot = policyDraftSnapshot(initial);
    const edited = withSelection(initial, selection("vpn"));
    const savedAgain = policyDraftSnapshot(edited);

    // First edit is dirty against the old baseline; after saving it is clean.
    expect(isPolicyDraftDirty(edited, savedSnapshot)).toBe(true);
    expect(isPolicyDraftDirty(edited, savedAgain)).toBe(false);

    // A further edit is dirty against the new baseline.
    expect(isPolicyDraftDirty(withSelection(edited, selection("cert")), savedAgain)).toBe(true);
  });

  it("ignores autosave timestamps in the comparison", () => {
    const draft = emptyPolicyDraft("Baseline");
    const saved = policyDraftSnapshot(draft);

    expect(isPolicyDraftDirty({ ...draft, savedAt: NOW }, saved)).toBe(false);
  });

  it("treats a browser autosave newer than the server draft as dirty", () => {
    const server = withSelection(emptyPolicyDraft("Baseline"), selection("wifi"));
    const local = { ...withSelection(server, selection("vpn")), savedAt: NOW };
    const baseline = seedPolicyDraftBaseline({
      persistedDraft: server,
      initialDraft: local,
      currentDraft: local,
    });

    expect(isPolicyDraftDirty(local, policyDraftSnapshot(baseline))).toBe(true);
  });

  it("is clean after legacy collection ids are normalised on both drafts", () => {
    const legacy: Selection = {
      ...selection("wifi"),
      collectionId: "apple:com.apple.wifi",
    };
    const server = withSelection(emptyPolicyDraft("Baseline"), legacy);
    const collections: CollectionSummary[] = [
      {
        id: "apple/profiles/com.apple.wifi",
        platform: "apple",
        kind: "profile",
        surface: "profile",
        identifier: "com.apple.wifi",
        name: "wifi",
        propertyCount: 0,
      },
    ];

    const { selections: normalised, rewrites } = normaliseSelectionCollectionIds(
      server.platforms.apple!,
      collections,
    );
    const baseline = applyCollectionIdRewrites(server, "apple", rewrites);
    const current = { ...server, platforms: { ...server.platforms, apple: normalised } };

    expect(isPolicyDraftDirty(current, policyDraftSnapshot(baseline))).toBe(false);
  });

  it("restores the previous baseline when a save fails", () => {
    const server = withSelection(emptyPolicyDraft("Baseline"), selection("wifi"));
    const edited = withSelection(server, selection("vpn"));

    // A save optimistically moves the baseline, then a failure puts it back.
    let baseline = edited;
    expect(isPolicyDraftDirty(edited, policyDraftSnapshot(baseline))).toBe(false);

    baseline = server;
    expect(isPolicyDraftDirty(edited, policyDraftSnapshot(baseline))).toBe(true);
  });
});
