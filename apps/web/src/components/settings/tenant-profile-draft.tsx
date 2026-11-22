import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { validateTenantBranding } from "@mattrax/enterprise-domain/client";
import { createContext, createEffect, createMemo, createSignal, useContext } from "solid-js";
import type { Accessor, Setter } from "solid-js";
import { enterprise, enterpriseKeys, enterpriseQueries } from "~/lib/enterprise";
import type { MeResponse, TenantDetail } from "~/lib/enterprise";
import { combineRestores, optimisticUpdate } from "~/lib/optimistic";
import { useCan } from "~/lib/permissions";
import { rememberTenantAlias } from "~/lib/tenant";

type TenantQuery = {
  readonly data: TenantDetail | undefined;
  readonly error: unknown;
  refetch: () => void;
};

type Profile = {
  name: string;
  slug: string;
  displayName: string;
  logo: string;
  supportEmail: string;
  brandColor: string;
  appStoreRegion: string;
  autoUnlink: boolean;
};

export type TenantProfileDraft = {
  readonly tenant: TenantQuery;
  readonly canWrite: Accessor<boolean>;
  readonly name: Accessor<string>;
  readonly setName: Setter<string>;
  readonly slug: Accessor<string>;
  readonly setSlug: Setter<string>;
  readonly displayName: Accessor<string>;
  readonly setDisplayName: Setter<string>;
  readonly logo: Accessor<string>;
  readonly setLogo: Setter<string>;
  readonly supportEmail: Accessor<string>;
  readonly setSupportEmail: Setter<string>;
  readonly brandColor: Accessor<string>;
  readonly setBrandColor: Setter<string>;
  readonly appStoreRegion: Accessor<string>;
  readonly setAppStoreRegion: Setter<string>;
  readonly autoUnlink: Accessor<boolean>;
  readonly setAutoUnlink: Setter<boolean>;
  readonly brandingErrors: Accessor<ReturnType<typeof validateTenantBranding>>;
  readonly hasBrandingErrors: Accessor<boolean>;
  readonly validationProblem: Accessor<string | null>;
  readonly dirty: Accessor<boolean>;
  readonly slugDirty: Accessor<boolean>;
  readonly savedSlug: Accessor<string>;
  readonly saving: Accessor<boolean>;
  readonly saved: Accessor<boolean>;
  readonly saveError: Accessor<unknown>;
  readonly slugConfirmOpen: Accessor<boolean>;
  readonly setSlugConfirmOpen: Setter<boolean>;
  readonly requestSave: () => void;
  readonly confirmSlugSave: () => void;
  readonly discard: () => void;
};

export const TenantProfileDraftContext = createContext<TenantProfileDraft>();

export function useTenantProfileDraft(): TenantProfileDraft {
  const draft = useContext(TenantProfileDraftContext);

  if (!draft) throw new Error("useTenantProfileDraft must be used inside the settings layout");

  return draft;
}

/**
 * The tenant profile form lives above the settings panes so it survives a tab
 * change and the layout can offer one explicit save bar. Keeping it here also
 * means the slug warning and unsaved-changes guard only run while the person is
 * actually inside tenant settings.
 */
export function createTenantProfileDraft(tenantId: string): TenantProfileDraft {
  const qc = useQueryClient();
  const { can } = useCan();
  const tenantQuery = useQuery(() => ({
    ...enterpriseQueries.tenant(tenantId),
    enabled: can("tenant.read"),
  }));

  const [name, setName] = createSignal("");
  const [slug, setSlug] = createSignal("");
  const [displayName, setDisplayName] = createSignal("");
  const [logo, setLogo] = createSignal("");
  const [supportEmail, setSupportEmail] = createSignal("");
  const [brandColor, setBrandColor] = createSignal("");
  const [appStoreRegion, setAppStoreRegion] = createSignal("");
  const [autoUnlink, setAutoUnlink] = createSignal(false);
  const [baseline, setBaseline] = createSignal<Profile | null>(null);
  const [seeded, setSeeded] = createSignal(false);
  const [saved, setSaved] = createSignal(false);
  const [slugConfirmOpen, setSlugConfirmOpen] = createSignal(false);

  const profile = (): Profile => ({
    name: name(),
    slug: slug(),
    displayName: displayName(),
    logo: logo(),
    supportEmail: supportEmail(),
    brandColor: brandColor(),
    appStoreRegion: appStoreRegion().trim().toUpperCase(),
    autoUnlink: autoUnlink(),
  });

  createEffect(
    () => tenantQuery.data?.id,
    () => {
      const data = tenantQuery.data;

      if (!data) return;
      setName(data.name);
      setSlug(data.slug);
      setDisplayName(data.displayName ?? "");
      setLogo(data.logo ?? "");
      setSupportEmail(data.supportEmail ?? "");
      setBrandColor(data.brandColor ?? "");
      setAppStoreRegion(data.appStoreRegion ?? "");
      setAutoUnlink(data.autoUnlinkUnavailableApplications ?? false);
      // Build the baseline from the row rather than reading the signals that
      // were just written: this keeps the seed independent of effect scheduling.
      setBaseline({
        name: data.name,
        slug: data.slug,
        displayName: data.displayName ?? "",
        logo: data.logo ?? "",
        supportEmail: data.supportEmail ?? "",
        brandColor: data.brandColor ?? "",
        appStoreRegion: data.appStoreRegion ?? "",
        autoUnlink: data.autoUnlinkUnavailableApplications ?? false,
      });
      setSeeded(true);
    },
  );

  const brandingErrors = createMemo(() =>
    validateTenantBranding({
      displayName: displayName() || null,
      logo: logo() || null,
      supportEmail: supportEmail() || null,
      brandColor: brandColor() || null,
    }),
  );

  const hasBrandingErrors = () => Object.keys(brandingErrors()).length > 0;

  const validationProblem = createMemo<string | null>(() => {
    if (!name().trim()) return "The tenant name is required.";
    if (!slug().trim()) return "The tenant slug is required.";
    if (!/^[a-z0-9-]+$/.test(slug()))
      return "The tenant slug can only contain lowercase letters, numbers and hyphens.";

    return null;
  });

  const dirty = () => {
    const current = baseline() ?? tenantQuery.data;

    if (!current || !seeded()) return false;

    return (
      name() !== current.name ||
      slug() !== current.slug ||
      displayName() !== (current.displayName ?? "") ||
      logo() !== (current.logo ?? "") ||
      supportEmail() !== (current.supportEmail ?? "") ||
      brandColor() !== (current.brandColor ?? "") ||
      appStoreRegion().trim().toUpperCase() !== (current.appStoreRegion ?? "") ||
      autoUnlink() !== savedAutoUnlink(current)
    );
  };

  const savedSlug = () => baseline()?.slug ?? tenantQuery.data?.slug ?? "";
  const savedAutoUnlink = (current: Profile | TenantDetail) =>
    "autoUnlink" in current
      ? current.autoUnlink
      : (current.autoUnlinkUnavailableApplications ?? false);
  const slugDirty = () => seeded() && slug() !== savedSlug();

  const save = useMutation(() => ({
    mutationFn: () =>
      enterprise.patchTenant(tenantId, {
        name: name(),
        slug: slug(),
        displayName: displayName() || null,
        logo: logo() || null,
        supportEmail: supportEmail() || null,
        brandColor: brandColor() || null,
        appStoreRegion: appStoreRegion().trim().toUpperCase() || null,
        autoUnlinkUnavailableApplications: autoUnlink(),
      }),
    onMutate: async () => {
      const patch = {
        name: name(),
        slug: slug(),
        displayName: displayName() || null,
        logo: logo() || null,
        supportEmail: supportEmail() || null,
        brandColor: brandColor() || null,
        appStoreRegion: appStoreRegion().trim().toUpperCase() || null,
        autoUnlinkUnavailableApplications: autoUnlink(),
      };
      const organizationId = tenantQuery.data?.id;

      const restores = await Promise.all([
        optimisticUpdate<TenantDetail>(qc, enterpriseKeys.tenant(tenantId), (current) => ({
          ...current,
          ...patch,
        })),
        // The shell and tenant switcher read branding from the membership list.
        optimisticUpdate<MeResponse>(qc, enterpriseKeys.me(), (current) => ({
          ...current,
          tenants: current.tenants.map((membership) =>
            membership.id === organizationId ? { ...membership, ...patch } : membership,
          ),
        })),
      ]);

      return combineRestores(restores);
    },
    onSuccess: () => {
      setBaseline(profile());
      setSlugConfirmOpen(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);

      // A slug change changes the canonical address of every tenant page. A
      // document load avoids racing the membership shell (which still has the
      // old slug for a moment) and lands on server-resolved data.
      if (slug() && slug() !== tenantId) {
        if (tenantQuery.data?.id) rememberTenantAlias(slug(), tenantQuery.data.id);
        window.location.replace(`/t/${encodeURIComponent(slug())}/settings`);

        return;
      }
    },
    onError: (_error, _variables, restore) => restore?.(),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: enterpriseKeys.tenant(tenantId) });
      void qc.invalidateQueries({ queryKey: enterpriseKeys.me() });
    },
  }));

  const requestSave = () => {
    if (save.isPending || !dirty() || hasBrandingErrors()) return;
    if (validationProblem()) return;
    if (slugDirty()) {
      setSlugConfirmOpen(true);

      return;
    }

    save.mutate();
  };

  const confirmSlugSave = () => {
    setSlugConfirmOpen(false);
    save.mutate();
  };

  const discard = () => {
    const current = baseline() ?? tenantQuery.data;

    if (!current) return;
    setName(current.name);
    setSlug(current.slug);
    setDisplayName(current.displayName ?? "");
    setLogo(current.logo ?? "");
    setSupportEmail(current.supportEmail ?? "");
    setBrandColor(current.brandColor ?? "");
    setAppStoreRegion(current.appStoreRegion ?? "");
    setAutoUnlink(savedAutoUnlink(current));
    setSaved(false);
    setSlugConfirmOpen(false);
  };

  return {
    tenant: tenantQuery,
    canWrite: () => can("tenant.write"),
    name,
    setName,
    slug,
    setSlug,
    displayName,
    setDisplayName,
    logo,
    setLogo,
    supportEmail,
    setSupportEmail,
    brandColor,
    setBrandColor,
    appStoreRegion,
    setAppStoreRegion,
    autoUnlink,
    setAutoUnlink,
    brandingErrors,
    hasBrandingErrors,
    validationProblem,
    dirty,
    slugDirty,
    savedSlug,
    saving: () => save.isPending,
    saved,
    saveError: () => save.error,
    slugConfirmOpen,
    setSlugConfirmOpen,
    requestSave,
    confirmSlugSave,
    discard,
  };
}
