import { useNavigate } from "@solidjs/router";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onSettled,
  Show,
  untrack,
} from "solid-js";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Check, Download, Plus, Search, ShieldCheck, X } from "~/components/ui/icons";
import { authClient } from "~/lib/auth";
import {
  collectionProperties,
  loadManifest,
  loadPlatform,
  resetPlatformCache,
  searchCollections,
  typeLabel,
  type CatalogManifest,
  type Collection,
  type PlatformData,
  type PlatformId,
  type Property,
} from "~/lib/policy-designer/catalog";
import {
  buildArtifact,
  defaultValues,
  valueKey,
  type Draft,
  type Selection,
} from "~/lib/policy-designer/build";

const keyOf = (collection: { id: string; name: string }) => `${collection.id}#${collection.name}`;

const templateSets: Record<
  PlatformId,
  Array<{ label: string; description: string; keys: string[] }>
> = {
  apple: [
    {
      label: "Apple security baseline",
      description: "Restrictions, passcode, firewall and software updates.",
      keys: [
        "apple/profiles/com.apple.applicationaccess#Restrictions",
        "apple/profiles/com.apple.mobiledevice.passwordpolicy#Passcode",
        "apple/profiles/com.apple.security.firewall#Firewall",
        "apple/profiles/com.apple.SoftwareUpdate#Software Update",
      ],
    },
  ],
  windows: [
    {
      label: "Windows security baseline",
      description: "BitLocker, Defender, device lock and firewall.",
      keys: [
        "windows/settings/bitlocker#BitLocker",
        "windows/settings/defender#Defender",
        "windows/settings/device-lock#Device Lock",
        "windows/settings/firewall#Firewall",
      ],
    },
  ],
  android: [
    {
      label: "Android baseline",
      description: "Start from the Android Management API policy.",
      keys: ["android/policy/Policy#Policy"],
    },
  ],
};

const parseStoredDraft = (value: string | null): Draft | undefined => {
  if (!value) return undefined;
  try {
    const draft = JSON.parse(value) as Draft;
    return draft.version === 1 && Array.isArray(draft.selections) ? draft : undefined;
  } catch {
    return undefined;
  }
};

const messageOf = (error: unknown) =>
  error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "Something went wrong";

export type PolicyDesignerProps = {
  readonly mode?: "public" | "dashboard";
  readonly initialDraft?: Draft;
  readonly saving?: boolean;
  readonly saveDisabled?: boolean;
  readonly error?: unknown;
  readonly storageKey?: string;
  readonly onSave?: (draft: Draft) => Promise<void> | void;
};

export function PolicyDesigner(props: PolicyDesignerProps) {
  const navigate = useNavigate();
  const session = authClient.useSession();
  // The initial draft is a one-shot snapshot from the route; it never changes
  // while this editor is mounted.
  const initialDraft = untrack(() => props.initialDraft);
  const storageKey = untrack(() => props.storageKey) ?? "mattrax:designer-autosave";
  const [platform, setPlatform] = createSignal<PlatformId>(initialDraft?.platform ?? "apple");
  const [name, setName] = createSignal(initialDraft?.name ?? "My MDM policy");
  const [query, setQuery] = createSignal("");
  const [activeKey, setActiveKey] = createSignal<string | null>(null);
  const [manifest, setManifest] = createSignal<CatalogManifest | null>(null);
  const [manifestError, setManifestError] = createSignal<string | null>(null);
  const [catalogs, setCatalogs] = createSignal<Partial<Record<PlatformId, PlatformData>>>({});
  const [catalogErrors, setCatalogErrors] = createSignal<Partial<Record<PlatformId, string>>>({});
  const [selectionMap, setSelectionMap] = createSignal<Record<PlatformId, Selection[]>>({
    apple: [],
    android: [],
    windows: [],
    ...(initialDraft ? { [initialDraft.platform]: initialDraft.selections } : {}),
  });
  const [notice, setNotice] = createSignal<string | null>(null);
  const [savedAt, setSavedAt] = createSignal<number | null>(null);
  let requestId = 0;

  const data = () => catalogs()[platform()] ?? null;
  const catalogError = () => catalogErrors()[platform()] ?? null;
  // A platform is loading until its catalogue has arrived or failed.
  const loading = () => !data() && !catalogError();

  const beginLoad = (target: PlatformId, force = false) => {
    if (force) resetPlatformCache(target);
    setCatalogErrors((current) => {
      const next = { ...current };
      delete next[target];
      return next;
    });
    if (!force && catalogs()[target]) return;
    const id = ++requestId;
    void loadPlatform(target)
      .then((value) => {
        if (id !== requestId) return;
        setCatalogs((current) => ({ ...current, [target]: value }));
      })
      .catch((error) => {
        if (id !== requestId) return;
        setCatalogErrors((current) => ({ ...current, [target]: messageOf(error) }));
      });
  };

  const retryCatalogue = () => {
    setManifestError(null);
    if (!manifest())
      void loadManifest()
        .then(setManifest)
        .catch((error) => setManifestError(messageOf(error)));
    beginLoad(platform(), true);
  };

  const choosePlatform = (next: PlatformId) => {
    if (platform() === next) return;
    setPlatform(next);
    setActiveKey(null);
    beginLoad(next);
  };

  const selections = () => selectionMap()[platform()] ?? [];
  const setSelections = (updater: (current: Selection[]) => Selection[]) =>
    setSelectionMap((current) => ({
      ...current,
      [platform()]: updater(current[platform()] ?? []),
    }));

  onSettled(() => {
    void loadManifest()
      .then(setManifest)
      .catch((error) => setManifestError(messageOf(error)));

    if (!initialDraft) {
      const stored = parseStoredDraft(localStorage.getItem(storageKey));
      if (stored) {
        setPlatform(stored.platform);
        setName(stored.name);
        setSelectionMap((current) => ({ ...current, [stored.platform]: stored.selections }));
        setNotice("Restored your last draft.");
      }
    }
    beginLoad(platform());
  });

  // Autosave drafts so the “design before sign-up” promise is real. The short
  // delay keeps a large Windows draft off the typing path.
  let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(autosaveTimer));
  createEffect(
    () => ({ platform: platform(), name: name(), selections: selections() }),
    (value) => {
      clearTimeout(autosaveTimer);
      autosaveTimer = setTimeout(() => {
        try {
          const draft: Draft & { savedAt: number } = {
            version: 1,
            platform: value.platform,
            name: value.name,
            selections: value.selections,
            savedAt: Date.now(),
          };
          localStorage.setItem(storageKey, JSON.stringify(draft));
          setSavedAt(draft.savedAt);
        } catch {
          // Storage can be unavailable in private mode; exporting still works.
        }
      }, 350);
    },
  );

  const filtered = createMemo(() => {
    const term = query().trim();
    if (!term) {
      return (data()?.collections ?? [])
        .filter((collection) => collection.platform === platform())
        .slice(0, 200);
    }
    if (data()) {
      const lower = term.toLowerCase();
      return data()!
        .collections.filter((collection) => {
          if (collection.platform !== platform()) return false;
          if (
            `${collection.name} ${collection.identifier} ${collection.group ?? ""}`
              .toLowerCase()
              .includes(lower)
          )
            return true;
          return collection.properties.some((property) =>
            `${property.name} ${property.key} ${property.address ?? ""}`
              .toLowerCase()
              .includes(lower),
          );
        })
        .slice(0, 200);
    }
    return searchCollections(
      (manifest()?.collections ?? []).filter((collection) => collection.platform === platform()),
      term,
    ).slice(0, 200);
  });
  const resultLabel = () => {
    const shown = filtered().length;
    const total = manifest()?.stats[platform()]?.collections ?? shown;
    if (query().trim()) return `${shown} matching collection${shown === 1 ? "" : "s"}`;
    return shown < total
      ? `Showing ${shown} of ${total.toLocaleString()} collections`
      : `${shown} collection${shown === 1 ? "" : "s"}`;
  };
  const active = createMemo<Collection | undefined>(() => {
    const key = activeKey();
    return key ? data()?.collections.find((collection) => keyOf(collection) === key) : undefined;
  });
  const selected = createMemo(
    () => new Set(selections().map((selection) => selection.collectionId)),
  );
  const activeSelection = createMemo(() =>
    selections().find((selection) => selection.collectionId === activeKey()),
  );

  const addCollection = (collection: Collection) => {
    const key = keyOf(collection);
    if (selected().has(key)) return;
    // A single Apple policy is either a configuration profile or a set of DDM
    // declarations. Mixing them silently drops one half of the draft.
    if (
      platform() === "apple" &&
      collection.kind !== "profile" &&
      collection.kind !== "declaration"
    )
      return;
    if (
      platform() === "apple" &&
      selections().some((selection) => selection.kind !== collection.kind)
    ) {
      setNotice(
        "Apple profiles and declarations are separate policies. Remove the other kind first, or start a new policy.",
      );
      return;
    }
    setSelections((current) => [
      ...current,
      {
        collectionId: key,
        identifier: collection.identifier,
        kind: collection.kind,
        surface: collection.surface,
        name: collection.name,
        properties: collectionProperties(collection),
        values: defaultValues(collection),
      },
    ]);
    setActiveKey(key);
  };

  const addByKey = (key: string) => {
    const collection = data()?.collections.find((item) => keyOf(item) === key);
    if (collection) addCollection(collection);
    return Boolean(collection);
  };

  const removeSelection = (key: string) =>
    setSelections((current) => current.filter((selection) => selection.collectionId !== key));

  const updateValue = (key: string, property: Property, value: unknown) =>
    setSelections((current) =>
      current.map((selection) =>
        selection.collectionId === key
          ? {
              ...selection,
              values: { ...selection.values, [valueKey(property, platform())]: value },
            }
          : selection,
      ),
    );

  const draft = (): Draft => ({
    version: 1,
    platform: platform(),
    name: name(),
    selections: selections(),
  });

  const applyTemplate = (keys: string[]) => {
    const added = keys.filter((key) => addByKey(key)).length;
    setNotice(
      added === keys.length
        ? "Template applied. Tune the settings, then export or save."
        : `Applied ${added} of ${keys.length} collections; the rest were not in this catalogue.`,
    );
  };

  const download = () => {
    const artifact = buildArtifact(draft());
    const blob = new Blob([artifact.content], { type: artifact.contentType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = artifact.fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(`Exported ${artifact.fileName}`);
  };

  const deploy = () => {
    try {
      localStorage.setItem("mattrax:designer-draft", JSON.stringify(draft()));
    } catch {
      setNotice("Could not save the draft in this browser. Export the artifact instead.");
      return;
    }
    const returnTo = "/dashboard?designerDraft=1";
    navigate(session().data?.user ? returnTo : `/login?returnTo=${encodeURIComponent(returnTo)}`);
  };

  const canSave = () => Boolean(props.onSave) && selections().length > 0 && !props.saveDisabled;
  const disabledHint = () => {
    if (props.saveDisabled) return "Confirm the replacement above before saving.";
    if (selections().length === 0) return "Add a template or a setting to get started.";
    return null;
  };
  const platforms = (): Array<{ id: PlatformId; short: string }> =>
    manifest()?.platforms ?? [
      { id: "apple", short: "Apple" },
      { id: "android", short: "Android" },
      { id: "windows", short: "Windows" },
    ];
  const platformName = () =>
    manifest()?.platforms.find((item) => item.id === platform())?.name ?? platform();
  const loadingLabel = () => {
    const stats = manifest()?.stats[platform()];
    return stats
      ? `Loading ${platformName()} settings — ${stats.properties.toLocaleString()} properties…`
      : `Loading ${platformName()} settings…`;
  };

  const templateButtons = () => (
    <div class="grid gap-2">
      <For each={templateSets[platform()]}>
        {(template) => (
          <button
            type="button"
            disabled={loading() || !data()}
            onClick={() => applyTemplate(template.keys)}
            class="w-full rounded-xl border-2 border-stone-200 bg-white p-3 text-left text-xs transition-colors hover:border-stone-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <strong class="block text-sm text-stone-900">{template.label}</strong>
            <span class="mt-1 block text-stone-500">{template.description}</span>
            <span class="mt-2 inline-flex whitespace-nowrap rounded-full bg-stone-900 px-2 py-0.5 text-[10px] font-medium text-white">
              Recommended
            </span>
          </button>
        )}
      </For>
    </div>
  );

  return (
    <div class="space-y-5">
      <div class="flex flex-col gap-3 rounded-2xl border bg-white p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div class="flex items-center gap-2">
            <span class="rounded-lg bg-stone-900 p-2 text-white">
              <ShieldCheck class="size-5" />
            </span>
            <div>
              <p class="text-xs font-medium uppercase tracking-[0.16em] text-stone-400">
                {props.mode === "dashboard" ? "Policy designer" : "MDM policy designer"}
              </p>
              <h2 class="text-xl font-semibold tracking-tight text-stone-900">
                {props.mode === "dashboard" ? "Design this policy" : "Build a policy in minutes"}
              </h2>
            </div>
          </div>
          <p class="mt-3 max-w-2xl text-sm text-stone-500">
            {props.mode === "dashboard"
              ? "Browse the same Apple, Windows and Android catalogue, then save the result to this policy. Android delivery needs an Android Enterprise connection."
              : "Browse Apple, Windows and Android settings and export a ready-to-use artifact. No account is needed to export; sign in only to deploy."}
          </p>
        </div>
        <div class="flex flex-col items-start gap-1 lg:items-end">
          <div class="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={download}
              disabled={selections().length === 0}
              title={selections().length === 0 ? "Add a setting to enable export" : undefined}
            >
              <Download class="mr-1 size-4" /> Export
            </Button>
            <Show
              when={props.onSave}
              fallback={
                <Button
                  onClick={deploy}
                  disabled={selections().length === 0}
                  title={selections().length === 0 ? "Add a setting to enable deploy" : undefined}
                >
                  Deploy in Mattrax →
                </Button>
              }
            >
              <Button
                disabled={!canSave() || props.saving}
                title={
                  props.saveDisabled
                    ? "Confirm the replacement above before saving"
                    : selections().length === 0
                      ? "Add a setting to enable save"
                      : undefined
                }
                onClick={() => void props.onSave?.(draft())}
              >
                {props.saving ? "Saving…" : "Save policy"}
              </Button>
            </Show>
          </div>
          <Show when={disabledHint()}>
            {(hint) => <p class="text-xs text-stone-400">{hint()}</p>}
          </Show>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <For each={platforms()}>
          {(item) => (
            <button
              type="button"
              aria-pressed={platform() === item.id ? "true" : "false"}
              onClick={() => {
                choosePlatform(item.id);
              }}
              class={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
                platform() === item.id
                  ? "border-stone-900 bg-stone-900 text-white"
                  : "border-stone-300 bg-white text-stone-600 hover:border-stone-500"
              }`}
            >
              {item.short}
            </button>
          )}
        </For>
        <Show
          when={manifestError()}
          fallback={
            <span class="ml-auto text-xs text-stone-400">
              {manifest()?.stats[platform()]?.properties.toLocaleString() ?? "…"} settings
            </span>
          }
        >
          {(error) => (
            <span role="alert" class="ml-auto text-xs text-red-600">
              {error()}{" "}
              <button type="button" class="underline" onClick={retryCatalogue}>
                Retry
              </button>
            </span>
          )}
        </Show>
      </div>

      <div class="grid gap-4 xl:grid-cols-[300px_1fr_290px]">
        <Card class="order-2 overflow-hidden xl:order-none">
          <CardHeader class="border-b">
            <CardTitle class="text-sm">Browse settings</CardTitle>
          </CardHeader>
          <CardContent class="p-0">
            <div class="border-b p-3">
              <div class="relative">
                <Search class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
                <Input
                  value={query()}
                  onInput={(event) => setQuery(event.currentTarget.value)}
                  placeholder="Search settings…"
                  aria-label="Search settings"
                  style={{ "padding-left": "2.25rem" }}
                />
              </div>
              <p class="mt-2 text-[11px] text-stone-400" aria-live="polite">
                {data() ? resultLabel() : "Loading catalogue…"}
              </p>
            </div>
            <div class="max-h-[36rem] overflow-auto" tabindex="0" aria-label="Settings catalogue">
              <Show
                when={!loading() && !catalogError()}
                fallback={
                  <div class="p-4 text-sm text-stone-500">
                    <Show when={catalogError()} fallback={<span>{loadingLabel()}</span>}>
                      {(error) => (
                        <div class="space-y-2">
                          <p role="alert" class="text-red-600">
                            {error()}
                          </p>
                          <Button size="sm" variant="outline" onClick={retryCatalogue}>
                            Retry
                          </Button>
                        </div>
                      )}
                    </Show>
                  </div>
                }
              >
                <For
                  each={filtered()}
                  fallback={
                    <p class="p-4 text-sm text-stone-500">No settings match that search.</p>
                  }
                >
                  {(collection) => (
                    <button
                      type="button"
                      onClick={() => setActiveKey(keyOf(collection))}
                      class={`flex w-full items-start gap-3 border-b px-3 py-3 text-left last:border-0 hover:bg-stone-50 ${
                        activeKey() === keyOf(collection) ? "bg-stone-50" : ""
                      }`}
                    >
                      <span class="min-w-0 flex-1">
                        <span class="block truncate text-sm font-medium text-stone-900">
                          {collection.name}
                        </span>
                        <span class="mt-0.5 block truncate text-xs text-stone-500">
                          {collection.group ?? collection.identifier}
                        </span>
                      </span>
                      <Show when={selected().has(keyOf(collection))}>
                        <Check class="mt-0.5 size-4 shrink-0 text-green-600" />
                      </Show>
                    </button>
                  )}
                </For>
              </Show>
            </div>
          </CardContent>
        </Card>

        <Card class="order-1 xl:order-none">
          <CardHeader class="flex flex-row items-start justify-between gap-3 border-b">
            <div class="min-w-0">
              <CardTitle class="truncate text-base">{active()?.name ?? "Start a policy"}</CardTitle>
              <Show when={active()}>
                {(collection) => (
                  <p class="mt-1 text-xs text-stone-500">
                    {collection().identifier}
                    <Show when={collection().minOs}> · {collection().minOs}+</Show>
                  </p>
                )}
              </Show>
            </div>
            <Show when={active()}>
              {(collection) => (
                <Show
                  when={selected().has(keyOf(collection()))}
                  fallback={
                    <Button size="sm" onClick={() => addCollection(collection())}>
                      <Plus class="mr-1 size-4" /> Add
                    </Button>
                  }
                >
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`Remove ${collection().name} from policy`}
                    onClick={() => removeSelection(keyOf(collection()))}
                  >
                    <X class="mr-1 size-4" /> Remove
                  </Button>
                </Show>
              )}
            </Show>
          </CardHeader>
          <CardContent class="max-h-[36rem] overflow-auto">
            <Show
              when={active()}
              fallback={
                <div class="space-y-5 py-4">
                  <div>
                    <h3 class="text-sm font-semibold text-stone-900">Start with a template</h3>
                    <p class="mt-1 text-sm text-stone-500">
                      The fastest way to see a real policy. Add a baseline, then tune individual
                      settings.
                    </p>
                    <div class="mt-3">{templateButtons()}</div>
                  </div>
                  <div class="rounded-xl border border-dashed p-4 text-sm text-stone-500">
                    Or search the catalogue and add settings one at a time.
                  </div>
                </div>
              }
            >
              {(collection) => (
                <div class="space-y-4">
                  <p class="text-sm leading-relaxed text-stone-600">{collection().description}</p>
                  <Show
                    when={activeSelection()}
                    fallback={
                      <div class="rounded-xl border border-dashed p-6 text-center">
                        <p class="text-sm text-stone-500">
                          Add this collection to configure its settings.
                        </p>
                        <Button class="mt-3" onClick={() => addCollection(collection())}>
                          Add to policy
                        </Button>
                      </div>
                    }
                  >
                    {(selection) => (
                      <div class="space-y-4">
                        <For
                          each={selection().properties.filter(
                            (property) => property.category !== "Envelope",
                          )}
                        >
                          {(property) => (
                            <PropertyField
                              property={property}
                              platform={platform()}
                              value={selection().values[valueKey(property, platform())]}
                              onChange={(value) =>
                                updateValue(selection().collectionId, property, value)
                              }
                            />
                          )}
                        </For>
                        <Show when={selection().kind === "declaration"}>
                          <p class="text-xs text-stone-400">
                            Type, identifier and server token are generated when you export or save.
                          </p>
                        </Show>
                      </div>
                    )}
                  </Show>
                </div>
              )}
            </Show>
          </CardContent>
        </Card>

        <div class="order-3 space-y-4 xl:order-none">
          <Card>
            <CardHeader class="border-b">
              <CardTitle class="text-sm">Your policy</CardTitle>
            </CardHeader>
            <CardContent class="space-y-3 p-3">
              <Input
                value={name()}
                onInput={(event) => setName(event.currentTarget.value)}
                placeholder={props.mode === "dashboard" ? "Profile name" : "Policy name"}
                aria-label={props.mode === "dashboard" ? "Profile name" : "Policy name"}
              />
              <p class="text-[11px] text-stone-400">
                {props.mode === "dashboard"
                  ? "Shown on devices. The Mattrax policy name stays the same."
                  : "Shown on devices and in the exported artifact."}
              </p>
              <Show
                when={selections().length > 0}
                fallback={<p class="text-xs text-stone-500">Add a collection to start building.</p>}
              >
                <For each={selections()}>
                  {(selection) => (
                    <div class="flex items-start gap-2 rounded-lg border p-2 text-xs">
                      <span class="min-w-0 flex-1">
                        <strong class="block truncate">{selection.name}</strong>
                        <span class="text-stone-500">
                          {Object.keys(selection.values).length} settings
                        </span>
                      </span>
                      <button
                        type="button"
                        class="text-stone-400 hover:text-stone-900"
                        onClick={() => removeSelection(selection.collectionId)}
                        aria-label={`Remove ${selection.name}`}
                      >
                        <X class="size-3.5" />
                      </button>
                    </div>
                  )}
                </For>
              </Show>
              <Show when={selections().length > 0}>
                <Button
                  size="sm"
                  variant="ghost"
                  class="w-full"
                  onClick={() => {
                    if (window.confirm("Clear every setting from this policy?")) {
                      setSelections(() => []);
                      setActiveKey(null);
                    }
                  }}
                >
                  Start over
                </Button>
              </Show>
              <Show when={savedAt()}>
                <p class="text-[11px] text-stone-400">Draft saved in this browser.</p>
              </Show>
            </CardContent>
          </Card>

          <Show when={active()}>
            <Card class="hidden xl:block">
              <CardHeader class="border-b">
                <CardTitle class="text-sm">Apply a template</CardTitle>
              </CardHeader>
              <CardContent class="space-y-2 p-3">{templateButtons()}</CardContent>
            </Card>
          </Show>

          <Show when={props.error}>
            {(error) => (
              <p
                role="alert"
                class="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700"
              >
                {messageOf(error())}
              </p>
            )}
          </Show>
          <Show when={notice()}>
            {(message) => (
              <p
                role="status"
                class="rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs text-stone-600"
              >
                {message()}
              </p>
            )}
          </Show>
        </div>
      </div>
    </div>
  );
}

function PropertyField(props: {
  property: Property;
  platform: PlatformId;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const id = () => `designer-${props.property.key.replace(/[^A-Za-z0-9_-]+/g, "-")}`;
  const isBoolean = () => props.property.type === "boolean" && !props.property.enum;
  const isArrayEnum = () => props.property.type === "array" && Boolean(props.property.enum);
  const enumValues = () => (props.property.type !== "array" ? props.property.enum : undefined);
  const arrayEnumValues = () => (props.property.type === "array" ? props.property.enum : undefined);
  const isGrouped = () => isBoolean() || isArrayEnum();

  /**
   * The catalogue serializes enum options as strings even for on/off and
   * numeric CSPs. Use the option domain (not just the default) so the stored
   * value keeps the type the plist/SyncML payload expects.
   */
  const enumKind = () => {
    const values = props.property.enum?.map((option) => option.value) ?? [];
    if (values.length > 0 && values.every((value) => value === "true" || value === "false"))
      return "boolean";
    if (
      values.length > 0 &&
      values.every((value) => value.trim() !== "" && Number.isFinite(Number(value)))
    )
      return "number";
    return "string";
  };
  const coerce = (value: string) => {
    const kind = enumKind();
    if (kind === "boolean") return value === "true";
    if (kind === "number") return Number(value);
    return value;
  };
  const arrayValue = () => (Array.isArray(props.value) ? (props.value as unknown[]) : []);
  const toggleArrayValue = (option: string, checked: boolean) => {
    const current = arrayValue().map(String);
    props.onChange(
      checked
        ? [...current.filter((value) => value !== option), option]
        : current.filter((value) => value !== option),
    );
  };

  return (
    <div class="space-y-1.5 rounded-lg border p-3">
      <div class="flex items-start justify-between gap-3">
        <Show
          when={!isGrouped()}
          fallback={
            <span class="text-sm font-medium text-stone-800">
              {props.property.name}
              <Show when={props.property.required}>
                <span class="ml-1 text-red-500" aria-hidden="true">
                  *
                </span>
              </Show>
            </span>
          }
        >
          <label for={id()} class="text-sm font-medium text-stone-800">
            {props.property.name}
            <Show when={props.property.required}>
              <span class="ml-1 text-red-500" aria-hidden="true">
                *
              </span>
            </Show>
          </label>
        </Show>
        <Badge variant="secondary" class="shrink-0 text-[10px]">
          {typeLabel(props.property.type)}
        </Badge>
      </div>
      <p class="text-xs leading-relaxed text-stone-500">{props.property.description}</p>
      <Show when={props.property.address}>
        {(address) => <p class="break-all font-mono text-[10px] text-stone-400">{address()}</p>}
      </Show>
      <Show when={props.property.defaultValue !== undefined}>
        <p class="text-[11px] text-stone-400">
          Default: {String(props.property.defaultValue)} ·{" "}
          <button
            type="button"
            class="underline"
            aria-label={`Reset ${props.property.name} to its default`}
            onClick={() => props.onChange(props.property.defaultValue)}
          >
            reset
          </button>
        </p>
      </Show>
      <Show when={enumValues()}>
        {(values) => (
          <select
            id={id()}
            class="h-9 w-full rounded-lg border bg-white px-3 text-sm"
            value={props.value === undefined ? "" : String(props.value)}
            onChange={(event) => {
              const selected = event.currentTarget.value;
              props.onChange(selected === "" ? undefined : coerce(selected));
            }}
          >
            <option value="">Not configured</option>
            <For each={values()}>
              {(option) => (
                <option value={option.value}>{option.description ?? option.value}</option>
              )}
            </For>
          </select>
        )}
      </Show>
      <Show when={arrayEnumValues()}>
        {(values) => (
          <div
            class="max-h-48 space-y-1 overflow-auto rounded-lg border bg-white p-2"
            role="group"
            aria-label={props.property.name}
          >
            <For each={values()}>
              {(option) => (
                <label class="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    class="mt-0.5"
                    checked={arrayValue().includes(option.value)}
                    onChange={(event) =>
                      toggleArrayValue(option.value, event.currentTarget.checked)
                    }
                  />
                  <span>{option.description ?? option.value}</span>
                </label>
              )}
            </For>
          </div>
        )}
      </Show>
      <Show when={isBoolean()}>
        <label class="flex items-center gap-2 text-sm">
          <input
            id={id()}
            type="checkbox"
            aria-label={props.property.name}
            checked={props.value === true}
            onChange={(event) => props.onChange(event.currentTarget.checked)}
          />
          Enabled
        </label>
      </Show>
      <Show when={!props.property.enum && props.property.type === "integer"}>
        <Input
          id={id()}
          type="number"
          value={props.value === undefined ? "" : String(props.value)}
          onInput={(event) => {
            const value = event.currentTarget.value;
            const number = value === "" ? undefined : Number(value);
            if (number === undefined || Number.isFinite(number)) props.onChange(number);
          }}
        />
      </Show>
      <Show when={!props.property.enum && props.property.type === "real"}>
        <Input
          id={id()}
          type="number"
          step="any"
          value={props.value === undefined ? "" : String(props.value)}
          onInput={(event) => {
            const value = event.currentTarget.value;
            const number = value === "" ? undefined : Number(value);
            if (number === undefined || Number.isFinite(number)) props.onChange(number);
          }}
        />
      </Show>
      <Show when={!props.property.enum && props.property.type === "date"}>
        <Input
          id={id()}
          type="date"
          value={props.value === undefined ? "" : String(props.value).slice(0, 10)}
          onInput={(event) =>
            props.onChange(
              event.currentTarget.value === ""
                ? undefined
                : new Date(`${event.currentTarget.value}T00:00:00Z`).toISOString(),
            )
          }
        />
      </Show>
      <Show
        when={
          !props.property.enum &&
          !["boolean", "integer", "real", "array", "dictionary", "data", "date"].includes(
            props.property.type,
          )
        }
      >
        <Input
          id={id()}
          value={props.value === undefined ? "" : String(props.value)}
          onInput={(event) => props.onChange(event.currentTarget.value)}
        />
      </Show>
      <Show when={["array", "dictionary", "data"].includes(props.property.type) && !isArrayEnum()}>
        <textarea
          id={id()}
          class="min-h-20 w-full rounded-lg border bg-white p-2 font-mono text-xs"
          value={
            props.value === undefined
              ? ""
              : typeof props.value === "string"
                ? props.value
                : JSON.stringify(props.value, null, 2)
          }
          onInput={(event) => {
            const value = event.currentTarget.value;
            if (props.property.type === "data") {
              props.onChange(value);
              return;
            }
            try {
              props.onChange(JSON.parse(value));
            } catch {
              props.onChange(value);
            }
          }}
        />
      </Show>
    </div>
  );
}
