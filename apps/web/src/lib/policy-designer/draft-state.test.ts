import { describe, expect, it } from "vitest";
import { emptyPolicyDraft } from "./build";
import type { PolicyDraft, Selection } from "./build";
import { isPolicyDraftDirty, policyDraftSnapshot } from "./draft-state";

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

    expect(isPolicyDraftDirty({ ...draft, savedAt: Date.now() }, saved)).toBe(false);
  });
});
