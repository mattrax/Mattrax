import { describe, expect, it } from "vitest";
import {
  initialTenantSlugDraft,
  slugifyTenantName,
  tenantSlugFor,
  updateTenantName,
  updateTenantSlug,
} from "./tenant-slug";
import type { TenantSlugDraft } from "./tenant-slug";

/** Type a value one character at a time, as the form receives it. */
const typeName = (value: string) => {
  let draft: TenantSlugDraft = initialTenantSlugDraft;
  let typed = "";

  for (const character of value) {
    typed += character;
    draft = updateTenantName(draft, typed);
  }

  return draft;
};

describe("tenant slug derivation", () => {
  it("keeps following the name for every character", () => {
    const draft = typeName("Acme Corp");

    expect(draft.slug).toBe("acme-corp");
    expect(draft.edited).toBe(false);
  });

  it("normalises punctuation and repeated separators", () => {
    expect(slugifyTenantName("  Acme & Sons -- Ltd. ")).toBe("acme-sons-ltd");
    expect(slugifyTenantName("***")).toBe("");
  });

  it("stops following once the slug is edited", () => {
    const draft = updateTenantSlug("acme-ops");

    expect(draft).toEqual({ slug: "acme-ops", edited: true });
    expect(updateTenantName(draft, "Acme Corporation")).toEqual({
      slug: "acme-ops",
      edited: true,
    });
  });

  it("resumes following when the slug is cleared", () => {
    const edited = updateTenantSlug("custom");
    const cleared = updateTenantSlug("");

    expect(edited.edited).toBe(true);
    expect(cleared).toEqual({ slug: "", edited: false });
    expect(updateTenantName(cleared, "Acme Corp")).toEqual({ slug: "acme-corp", edited: false });
  });

  it("submits the derived slug when the field is empty", () => {
    expect(tenantSlugFor(initialTenantSlugDraft, "Acme Corp")).toBe("acme-corp");
    expect(tenantSlugFor(updateTenantSlug("acme-ops"), "Acme Corp")).toBe("acme-ops");
  });
});
