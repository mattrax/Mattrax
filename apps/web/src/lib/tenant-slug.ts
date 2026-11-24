/**
 * The create-tenant form derives a URL slug from the tenant name until the
 * administrator edits the slug themselves.
 *
 * The first keystroke in the name used to freeze the slug because the form
 * asked "is the slug empty?" instead of "has the slug been edited?". A derived
 * one-character slug is non-empty, so the next keystrokes stopped arriving.
 * The draft below tracks the intent explicitly and lets clearing the field
 * resume derivation.
 */
export type TenantSlugDraft = {
  readonly slug: string;
  /** True once the administrator has typed in the slug field themselves. */
  readonly edited: boolean;
};

export const initialTenantSlugDraft: TenantSlugDraft = { slug: "", edited: false };

/** Lowercase, dash-separated, with no leading or trailing dash. */
export const slugifyTenantName = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");

export const updateTenantName = (draft: TenantSlugDraft, name: string): TenantSlugDraft =>
  draft.edited ? draft : { slug: slugifyTenantName(name), edited: false };

export const updateTenantSlug = (value: string): TenantSlugDraft => {
  const slug = slugifyTenantName(value);

  // Clearing the field hands derivation back to the tenant name. Typing
  // anything else, even punctuation that normalises away, keeps manual control.
  return { slug, edited: slug.length > 0 };
};

/** The slug that will actually be submitted: the field, or a fresh derivation. */
export const tenantSlugFor = (draft: TenantSlugDraft, name: string): string =>
  draft.slug || slugifyTenantName(name);
