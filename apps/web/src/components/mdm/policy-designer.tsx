import { Checkbox } from "@mattrax/ui";
import { useNavigate } from "~/lib/navigation";
import { Option, Schema } from "effect";
import type { JSX } from "@solidjs/web";
import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  For,
  onCleanup,
  onSettled,
  Show,
  untrack,
} from "solid-js";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import AdmxImportDialog from "~/components/mdm/admx-import";
import CisTemplateDialog from "~/components/mdm/cis-template-dialog";
import type { CisTemplateOutcome } from "~/components/mdm/cis-template-dialog";
import DocumentationLink from "~/components/mdm/documentation-link";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  CircleAlert,
  Download,
  Info,
  PanelRight,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  TriangleAlert,
  X,
} from "~/components/ui/icons";
import { Input } from "~/components/ui/input";
import { useUnsavedChanges } from "~/lib/unsaved-changes";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "~/components/ui/sheet";
import { authClient } from "~/lib/auth";
import { chord, useCommands } from "~/lib/commands";
import type { Command } from "~/lib/commands";
import { errorMessage, raisedFailure } from "~/lib/errors";
import { disposeCatalogueRuntime } from "~/lib/catalogue-service";
import {
  collectionProperties,
  loadAppleOsSupport,
  loadCollection,
  loadManifest,
  loadPlatformIndex,
  loadSearchIndex,
  searchIndexProperties,
  appleCollectionManaged,
  appleOsRangeLabel,
  typeLabel,
} from "~/lib/policy-designer/catalog";
import type {
  AppleOsSupportManifest,
  CatalogManifest,
  Collection,
  CollectionSummary,
  PlatformId,
  PlatformIndex,
  Property,
  SearchIndex,
} from "~/lib/policy-designer/catalog";
import {
  collectionDocumentationUrl,
  propertyDocumentationUrl,
} from "~/lib/policy-designer/documentation";
import {
  PLATFORM_ORDER,
  buildPolicyBundle,
  catalogDefault,
  defaultValues,
  draftForPlatform,
  emptyPolicyDraft,
  isChangedValue,
  isConfiguredValue,
  parsePolicyDraft,
  policyPlatforms,
  policySelectionCount,
  sameValue,
  validateDraft,
  valueKey,
} from "~/lib/policy-designer/build";
import type {
  PolicyDraft,
  PolicyValue,
  Selection,
  SelectionTemplate,
  ValidationIssue,
} from "~/lib/policy-designer/build";
import {
  applyCollectionIdRewrites,
  isPolicyDraftDirty,
  normaliseSelectionCollectionIds,
  policyDraftSnapshot,
  seedPolicyDraftBaseline,
} from "~/lib/policy-designer/draft-state";
import { admxCollectionFromSelection, isAdmxCollectionId } from "~/lib/policy-designer/admx";
import type { AdmxSelection } from "~/lib/policy-designer/admx";
import {
  isThirdPartyCollectionId,
  loadThirdPartyApps,
  thirdPartyAppCollection,
  thirdPartyAppCollectionId,
  thirdPartyAppsForPlatform,
  thirdPartyCollectionPlatform,
  thirdPartySelectionTemplate,
} from "~/lib/policy-designer/thirdPartyApps";
import type { ThirdPartyApp, ThirdPartyCatalog } from "~/lib/policy-designer/thirdPartyApps";

import { cn } from "~/lib/utils";

const keyOf = (collection: { id: string; name: string }) => `${collection.id}#${collection.name}`;

/** Selections store `${collection.id}#${collection.name}`; loaders need just the id. */
const collectionIdOf = (selectionId: string) => selectionId.split("#")[0] ?? selectionId;

const safeId = (value: string) => value.replaceAll(/[^A-Za-z0-9_-]+/g, "-");

/** DOM ids include platform, scope and the serialized value key, as requested. */
const fieldId = (platform: PlatformId, property: Property) =>
  `designer-field-${platform}-${property.scope ?? "any"}-${safeId(valueKey(property, platform))}`;

const SECTION_FALLBACK = "Settings";

const sectionLabel = (property: Property) => {
  if (property.category && property.category !== "Envelope") return property.category;

  if (property.scope)
    return `${property.scope.charAt(0).toUpperCase()}${property.scope.slice(1)} settings`;

  return SECTION_FALLBACK;
};

/** The catalogue ships without groups on some platforms; keep discovery useful. */
const collectionGroup = (collection: {
  platform: PlatformId;
  kind: Collection["kind"];
  group?: string;
}) => {
  if (collection.group?.trim()) return collection.group.trim();

  if (collection.platform === "apple")
    return collection.kind === "declaration" ? "DDM declarations" : "Configuration profiles";

  if (collection.platform === "android") return "Android Management API";

  // Windows mixes grouped ADMX content with ungrouped Policy CSP settings.
  // Surface the CSP settings first: they are the ones most policies configure.
  return "General settings";
};

/** How many managed settings one third-party app offers on a platform. */
const thirdPartySettingCount = (app: ThirdPartyApp, platform: PlatformId): number => {
  switch (platform) {
    case "apple":
      return app.apple?.settings.length ?? 0;
    case "windows":
      return app.windows?.settings.length ?? 0;
    default:
      return app.android?.settings.length ?? 0;
  }
};

const isBoolean = Schema.is(Schema.Boolean);

const isString = Schema.is(Schema.String);

const isJsonObject = Schema.is(Schema.JsonObject);

const decodeJson = Schema.decodeUnknownOption(Schema.Json);

const formatValue = (value: PolicyValue | undefined) => {
  if (value === undefined) return "Not set";

  if (value === null) return "Empty";

  if (isBoolean(value)) return value ? "On" : "Off";

  if (Array.isArray(value)) return value.length === 0 ? "Empty list" : JSON.stringify(value);

  if (isJsonObject(value)) return JSON.stringify(value);

  return String(value);
};

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

const SECTION_PAGE = 60;

const SECTION_PAGE_INCREMENT = 40;

export type PolicyDesignerProps = {
  readonly mode?: "public" | "dashboard";
  readonly initialDraft?: PolicyDraft;
  /** The draft currently persisted on the policy, used for honest save status. */
  readonly persistedDraft?: PolicyDraft;
  readonly saving?: boolean;
  readonly saveDisabled?: boolean;
  /** Why saving is blocked, when the parent knows a more specific reason. */
  readonly disabledHint?: string;
  /** Dashboard viewers without `policies.write` cannot create a policy either. */
  readonly canDeploy?: boolean;
  readonly error?: unknown;
  readonly storageKey?: string;
  readonly onSave?: (draft: PolicyDraft) => Promise<void> | void;
  /** Optional page-level links rendered in the compact top bar. */
  readonly pageActions?: JSX.Element;
  /** Reports platform changes so a parent can warn about saved configurations. */
  readonly onPlatformChange?: (platform: PlatformId) => void;
};

export default function PolicyDesigner(props: PolicyDesignerProps) {
  const navigate = useNavigate();
  const session = authClient.useSession();
  // The initial draft is a one-shot snapshot from the route; it never changes
  // while this editor is mounted.
  const initialDraft = untrack(() => props.initialDraft);
  const storageKey = untrack(() => props.storageKey) ?? "mattrax:designer-autosave";
  const initialPlatform = () => policyPlatforms(initialDraft ?? emptyPolicyDraft())[0] ?? "apple";
  const [platform, setPlatform] = createSignal<PlatformId>(initialPlatform());
  const [name, setName] = createSignal(initialDraft?.name ?? "My MDM policy");
  const [query, setQuery] = createSignal("");
  const [filterQuery, setFilterQuery] = createSignal("");
  const [filterMode, setFilterMode] = createSignal<"all" | "configured" | "changed">("all");
  const [activeKey, setActiveKey] = createSignal<string | null>(null);
  const [manifest, setManifest] = createSignal<CatalogManifest | null>(null);
  const [manifestError, setManifestError] = createSignal<string | null>(null);
  const [indexes, setIndexes] = createSignal<Partial<Record<PlatformId, PlatformIndex>>>({});
  const [indexErrors, setIndexErrors] = createSignal<Partial<Record<PlatformId, string>>>({});
  // Windows collections arrive one file at a time; the cache is keyed by
  // `${platform}:${collectionId}` so a loaded collection stays available when
  // the user switches platforms and comes back.
  const [collections, setCollections] = createSignal<Record<string, Collection>>({});
  const [collectionErrors, setCollectionErrors] = createSignal<Record<string, string>>({});
  const [loadingCollections, setLoadingCollections] = createSignal<Record<string, boolean>>({});
  const [thirdParty, setThirdParty] = createSignal<ThirdPartyCatalog | null>(null);
  const [thirdPartyError, setThirdPartyError] = createSignal<string | null>(null);
  const [admxOpen, setAdmxOpen] = createSignal(false);
  const [cisOpen, setCisOpen] = createSignal(false);

  const [searchIndexes, setSearchIndexes] = createSignal<Partial<Record<PlatformId, SearchIndex>>>(
    {},
  );

  const [searchIndexErrors, setSearchIndexErrors] = createSignal<
    Partial<Record<PlatformId, string>>
  >({});

  const [selectionMap, setSelectionMap] = createSignal<Record<PlatformId, Selection[]>>({
    apple: [],
    android: [],
    windows: [],
    ...initialDraft?.platforms,
  });

  const [notice, setNotice] = createSignal<string | null>(null);
  const [liveMessage, setLiveMessage] = createSignal("");
  const [showDeprecated, setShowDeprecated] = createSignal(false);
  const [visibleCount, setVisibleCount] = createSignal(SECTION_PAGE);
  const [collapsedGroups, setCollapsedGroups] = createSignal<Record<string, boolean>>({});
  const [collapsedSections, setCollapsedSections] = createSignal<Record<string, boolean>>({});
  const [mobileView, setMobileView] = createSignal<"browse" | "editor">("editor");
  const [summaryOpen, setSummaryOpen] = createSignal(false);
  const [issuesOpen, setIssuesOpen] = createSignal(false);

  const [invalidStructured, setInvalidStructured] = createSignal<
    Record<
      string,
      {
        collectionId: string;
        collectionName: string;
        propertyKey: string;
        propertyName: string;
      }
    >
  >({});

  const [startOverOpen, setStartOverOpen] = createSignal(false);
  const [removeTarget, setRemoveTarget] = createSignal<Selection | null>(null);
  let requestId = 0;
  const requestIds = new Map<PlatformId, number>();
  let errorRef: HTMLDivElement | undefined;
  createEffect(
    () => props.error,
    (error) => {
      if (!error) return;
      queueMicrotask(() => errorRef?.scrollIntoView({ block: "nearest" }));
    },
  );

  const initialPolicy = untrack(() => {
    const policy = emptyPolicyDraft(name());
    policy.platforms = { ...selectionMap() };

    return policy;
  });

  const initialSnapshot = untrack(() => policyDraftSnapshot(initialPolicy));

  /**
   * The draft as of the last save, seeded from the server's persisted draft.
   * A newer browser autosave therefore counts as dirty and prompts before it
   * is discarded. The designer's persisted configurations can be a lossy
   * projection, so saving resets this baseline explicitly.
   */
  const [savedDraft, setSavedDraft] = createSignal<PolicyDraft>(
    untrack(() =>
      seedPolicyDraftBaseline({
        persistedDraft: props.persistedDraft,
        initialDraft,
        currentDraft: initialPolicy,
      }),
    ),
  );

  const data = () => indexes()[platform()] ?? null;
  const catalogError = () => indexErrors()[platform()] ?? null;
  // A platform is loading until its index has arrived or failed.
  const loading = () => !data() && !catalogError();

  const thirdPartyApps = createMemo(() =>
    thirdParty() ? thirdPartyAppsForPlatform(thirdParty()!, platform()) : [],
  );

  // Rehydrate collections for selections saved by a previous session. The
  // catalogue file is the only source for their properties and defaults.
  createEffect(
    () => thirdParty(),
    (catalog) => {
      if (!catalog) return;
      untrack(() => {
        for (const target of PLATFORM_ORDER) {
          for (const selection of selectionMap()[target] ?? []) {
            if (!isThirdPartyCollectionId(selection.collectionId)) continue;
            const appId = selection.collectionId.split(":")[2] ?? "";
            const app = catalog.applications.find((entry) => entry.id === appId);
            const collection = app ? thirdPartyAppCollection(app, target) : null;
            const cacheKey = collectionCacheKey(target, selection.collectionId);

            if (collection && !collections()[cacheKey])
              setCollections((current) => ({ ...current, [cacheKey]: collection }));
          }
        }
      });
    },
  );

  const collectionCacheKey = (target: PlatformId, collectionId: string) =>
    `${target}:${collectionId}`;

  /**
   * Load one collection's properties, remembering in-flight and failed loads.
   * Untracked so calling it from an effect does not subscribe the effect to the
   * collection cache.
   */
  const ensureCollection = (collectionId: string, target?: PlatformId) =>
    untrack(() => {
      const targetPlatform = target ?? platform();
      const cacheKey = collectionCacheKey(targetPlatform, collectionId);

      if (collections()[cacheKey] || loadingCollections()[cacheKey]) return;

      // Imported ADMX collections live in the draft, not the catalogue: the
      // selection already carries every property and value key.
      if (isAdmxCollectionId(collectionId)) {
        const selection = (selectionMap()[targetPlatform] ?? []).find(
          (item) => collectionIdOf(item.collectionId) === collectionId,
        );

        const collection = selection ? admxCollectionFromSelection(selection) : null;

        if (collection) setCollections((current) => ({ ...current, [cacheKey]: collection }));

        return;
      }

      // Third-party app collections are data, not catalogue entries: build them
      // from the loaded app catalogue instead of fetching a platform file.
      if (isThirdPartyCollectionId(collectionId)) {
        const catalog = thirdParty();

        if (!catalog) return;
        const appId = collectionId.split(":")[2] ?? "";
        const app = catalog.applications.find((entry) => entry.id === appId);
        const sourcePlatform = thirdPartyCollectionPlatform(collectionId) ?? targetPlatform;
        const collection = app ? thirdPartyAppCollection(app, sourcePlatform) : null;

        if (collection) setCollections((current) => ({ ...current, [cacheKey]: collection }));

        return;
      }

      setLoadingCollections((current) => ({ ...current, [cacheKey]: true }));
      setCollectionErrors((current) => {
        if (!(cacheKey in current)) return current;
        const next = { ...current };
        delete next[cacheKey];

        return next;
      });
      void loadCollection(targetPlatform, collectionId)
        .then((collection) => setCollections((current) => ({ ...current, [cacheKey]: collection })))
        .catch((error: unknown) =>
          setCollectionErrors((current) => ({
            ...current,
            [cacheKey]: errorMessage(raisedFailure(error)),
          })),
        )
        .finally(() =>
          setLoadingCollections((current) => {
            const next = { ...current };
            delete next[cacheKey];

            return next;
          }),
        );
    });

  // A saved draft stores its properties, but loading the catalogue entry keeps
  // counts, search matches and reset actions working without opening each one.
  const ensureDraftCollections = (target: PlatformId) =>
    untrack(() => {
      for (const selection of selectionMap()[target] ?? [])
        ensureCollection(collectionIdOf(selection.collectionId), target);
    });

  const beginLoad = (target: PlatformId, force = false) => {
    if (force) void disposeCatalogueRuntime();
    setIndexErrors((current) => {
      const next = { ...current };
      delete next[target];

      return next;
    });

    if (!force && indexes()[target]) {
      ensureDraftCollections(target);

      return;
    }

    const id = ++requestId;
    requestIds.set(target, id);
    void loadPlatformIndex(target)
      .then((value) => {
        if (requestIds.get(target) !== id) return;
        setIndexes((current) => ({ ...current, [target]: value }));
        ensureDraftCollections(target);
      })
      .catch((error: unknown) => {
        if (requestIds.get(target) !== id) return;
        setIndexErrors((current) => ({ ...current, [target]: errorMessage(raisedFailure(error)) }));
      });
  };

  const retryCatalogue = () => {
    setManifestError(null);

    if (!manifest())
      void loadManifest()
        .then(setManifest)
        .catch((error: unknown) => setManifestError(errorMessage(raisedFailure(error))));
    const target = platform();
    setIndexes((current) => {
      const next = { ...current };
      delete next[target];

      return next;
    });
    setSearchIndexes((current) => {
      const next = { ...current };
      delete next[target];

      return next;
    });
    setSearchIndexErrors((current) => {
      const next = { ...current };
      delete next[target];

      return next;
    });
    setCollections({});
    setCollectionErrors({});
    setLoadingCollections({});
    beginLoad(target, true);
  };

  /**
   * Switching platform is non-destructive: each platform keeps its own
   * selections in `selectionMap`, so all of them can be edited and exported as
   * one policy.
   */
  const applyPlatform = (next: PlatformId) => {
    setPlatform(next);
    setActiveKey(selectionMap()[next]?.[0]?.collectionId ?? null);
    setQuery("");
    setFilterQuery("");
    setFilterMode("all");
    setCollapsedSections({});
    setMobileView("editor");
    beginLoad(next);
    props.onPlatformChange?.(next);
  };

  const choosePlatform = (next: PlatformId) => {
    if (platform() === next) return;
    applyPlatform(next);
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
      .catch((error: unknown) => setManifestError(errorMessage(raisedFailure(error))));

    // Optional: without it the designer falls back to the catalogue's earliest
    // minimum OS instead of a per-family range.
    void loadAppleOsSupport()
      .then(setOsSupport)
      .catch(() => undefined);

    void loadThirdPartyApps()
      .then(setThirdParty)
      .catch((error: unknown) => setThirdPartyError(errorMessage(raisedFailure(error))));

    if (!initialDraft) {
      const stored = parsePolicyDraft(localStorage.getItem(storageKey));

      if (stored) {
        setPlatform(policyPlatforms(stored)[0] ?? "apple");
        setName(stored.name);
        setSelectionMap((current) => ({ ...current, ...stored.platforms }));
        setNotice("Restored your last draft.");
      }
    }

    beginLoad(platform());

    return () => {};
  });

  // Autosave drafts so the “design before sign-up” promise is real. The short
  // delay keeps a large Windows draft off the typing path.
  let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(autosaveTimer));
  createEffect(
    () => ({ name: name(), selections: selectionMap() }),
    (value) => {
      clearTimeout(autosaveTimer);

      // Do not rewrite the browser draft merely because the editor mounted.
      if (
        policyDraftSnapshot({ ...emptyPolicyDraft(value.name), platforms: value.selections }) ===
        initialSnapshot
      )
        return;
      autosaveTimer = setTimeout(() => {
        try {
          const policy: PolicyDraft = {
            version: 2,
            name: value.name,
            platforms: value.selections,
            savedAt: Date.now(),
          };

          localStorage.setItem(storageKey, JSON.stringify(policy));
        } catch {
          // Storage can be unavailable in private mode; exporting still works.
        }
      }, 350);
    },
  );

  // Restore the last active collection (or the first one) when the catalogue
  // arrives, instead of greeting a configured policy with an empty state.
  createEffect(
    () => ({ data: data(), platform: platform(), active: activeKey(), selections: selections() }),
    (value) => {
      if (!value.data) return;

      // Drafts written by older builds used `apple:<identifier>` instead of the
      // catalogue key (`apple/profiles/<identifier>#Name`). Resolve them against
      // the loaded index rather than showing an empty editor, and apply the
      // same rewrite to the saved baseline so a merely-opened legacy policy is
      // not reported as dirty.
      const { selections: normalised, rewrites } = normaliseSelectionCollectionIds(
        value.selections,
        value.data.collections,
      );

      if (rewrites.size > 0) {
        setSelections(() => normalised);
        setSavedDraft((current) => applyCollectionIdRewrites(current, value.platform, rewrites));
      }

      if (
        value.active &&
        (value.data.collections.some((collection) => keyOf(collection) === value.active) ||
          isThirdPartyCollectionId(value.active) ||
          isAdmxCollectionId(value.active))
      ) {
        ensureCollection(collectionIdOf(value.active));

        return;
      }

      const first = normalised[0];
      setActiveKey(first ? first.collectionId : null);

      if (first) ensureCollection(collectionIdOf(first.collectionId));
    },
  );

  // Property search needs the per-property text, which Windows ships separately.
  // Fetch it on the first non-empty query (never on page load) and keep it for
  // the rest of the session.
  createEffect(
    () => ({ platform: platform(), term: query().trim() }),
    (value) => {
      if (!value.term) return;
      untrack(() => {
        if (searchIndexes()[value.platform] || searchIndexErrors()[value.platform]) return;
        void loadSearchIndex(value.platform)
          .then((index) => setSearchIndexes((current) => ({ ...current, [value.platform]: index })))
          .catch((error: unknown) =>
            setSearchIndexErrors((current) => ({
              ...current,
              [value.platform]: errorMessage(raisedFailure(error)),
            })),
          );
      });
    },
  );

  const searchIndexLoading = () =>
    query().trim() !== "" && !searchIndexes()[platform()] && !searchIndexErrors()[platform()];

  const searchEntries = createMemo(() => {
    const term = query().trim().toLowerCase();
    const current = data();

    if (!term || !current) return null;
    const tokens = term.split(/\s+/).filter(Boolean);
    const matches = (text: string) => tokens.every((token) => text.includes(token));
    const searchIndex = searchIndexes()[platform()];
    const propertyMatches = searchIndex ? searchIndexProperties(searchIndex, term) : null;
    const entries = new Map<string, { collection: CollectionSummary; matchKeys: Set<string> }>();

    for (const collection of current.collections) {
      if (collection.platform !== platform()) continue;

      const collectionMatches = matches(
        `${collection.name} ${collection.identifier} ${collection.group ?? ""}`.toLowerCase(),
      );

      const matchKeys = new Set(propertyMatches?.get(collection.id) ?? []);

      if (!collectionMatches && matchKeys.size === 0) continue;
      entries.set(keyOf(collection), { collection, matchKeys });
    }

    return entries;
  });

  const browseItems = createMemo(() => {
    const current = data();

    if (!current) return [];
    const entries = searchEntries();

    return current.collections
      .filter(
        (collection) =>
          collection.platform === platform() &&
          (showDeprecated() || !collection.deprecated) &&
          (!entries || entries.has(keyOf(collection))),
      )
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((collection) => ({
        collection,
        matchCount: entries?.get(keyOf(collection))?.matchKeys.size ?? 0,
      }));
  });

  const browseGroups = createMemo(() => {
    const groups = new Map<string, Array<{ collection: CollectionSummary; matchCount: number }>>();

    for (const item of browseItems()) {
      const label = collectionGroup(item.collection);
      const list = groups.get(label) ?? [];
      list.push(item);
      groups.set(label, list);
    }

    return [...groups.entries()]
      .map(([label, items]) => ({ label, items }))
      .sort((a, b) => {
        if (a.label === "General settings") return -1;

        if (b.label === "General settings") return 1;

        return a.label.localeCompare(b.label);
      });
  });

  const renderedGroups = createMemo(() => {
    let remaining = visibleCount();

    return browseGroups().map((group) => {
      const collapsed = Boolean(collapsedGroups()[group.label]);
      const items = collapsed ? [] : group.items.slice(0, Math.max(0, remaining));
      remaining -= items.length;

      return { ...group, collapsed, items, total: group.items.length };
    });
  });

  const expandedBrowseTotal = createMemo(() =>
    browseGroups()
      .filter((group) => !collapsedGroups()[group.label])
      .reduce((total, group) => total + group.items.length, 0),
  );

  const shownBrowseCount = createMemo(() =>
    renderedGroups().reduce((total, group) => total + group.items.length, 0),
  );

  const deprecatedCount = createMemo(
    () =>
      (data()?.collections ?? []).filter(
        (collection) => collection.platform === platform() && collection.deprecated,
      ).length,
  );

  createEffect(
    () => ({ platform: platform(), query: query(), deprecated: showDeprecated() }),
    () => {
      setVisibleCount(SECTION_PAGE);
      setCollapsedGroups({});
    },
  );

  const activeSummary = createMemo<CollectionSummary | undefined>(() => {
    const key = activeKey();

    if (!key) return undefined;
    const found = data()?.collections.find((collection) => keyOf(collection) === key);

    if (found) return found;

    // Third-party apps and imported ADMX policies live outside the platform
    // catalogue index; the selection carries everything the editor needs.
    const selection = selections().find((item) => item.collectionId === key);
    const admx = isAdmxCollectionId(key);

    if (!selection || (!isThirdPartyCollectionId(key) && !admx)) return undefined;

    return {
      id: collectionIdOf(key),
      platform: platform(),
      kind: selection.kind,
      surface: selection.surface,
      identifier: selection.identifier,
      name: selection.name,
      group: admx ? "ADMX import" : "Third-party apps",
      propertyCount: selection.properties.length,
    };
  });

  const activeCollection = createMemo<Collection | undefined>(() => {
    const key = activeKey();

    if (!key) return undefined;
    const cached = collections()[collectionCacheKey(platform(), collectionIdOf(key))];

    if (cached) return cached;

    if (isAdmxCollectionId(key)) {
      const selection = selections().find((item) => item.collectionId === key);

      return selection ? (admxCollectionFromSelection(selection) ?? undefined) : undefined;
    }

    if (!isThirdPartyCollectionId(key)) return undefined;

    const selection = selections().find((item) => item.collectionId === key);

    const catalog = thirdParty();

    const app = catalog?.applications.find((entry) => entry.id === (key.split(":")[2] ?? ""));

    if (!selection || !app) return undefined;

    return (
      thirdPartyAppCollection(app, thirdPartyCollectionPlatform(key) ?? platform()) ?? undefined
    );
  });

  const activeCollectionLoading = () => {
    const key = activeKey();

    return key
      ? Boolean(loadingCollections()[collectionCacheKey(platform(), collectionIdOf(key))])
      : false;
  };

  const activeCollectionError = () => {
    const key = activeKey();

    return key
      ? collectionErrors()[collectionCacheKey(platform(), collectionIdOf(key))]
      : undefined;
  };

  const selected = createMemo(
    () => new Set(selections().map((selection) => selection.collectionId)),
  );

  const activeSelection = createMemo(() =>
    selections().find((selection) => selection.collectionId === activeKey()),
  );

  const activeDocumentation = createMemo(() => {
    const key = activeKey();

    if (!key || isThirdPartyCollectionId(key)) return undefined;
    const collection = activeCollection() ?? activeSummary();

    if (!collection) return undefined;

    return collectionDocumentationUrl(platform(), collection);
  });

  const activeMatchKeys = createMemo<Set<string> | null>(() => {
    const key = activeKey();

    if (!key) return null;
    const entry = searchEntries()?.get(key);

    if (!entry || entry.matchKeys.size === 0) return null;

    return entry.matchKeys;
  });

  const settingCount = (selection: Selection) =>
    selection.properties.filter((property) => property.category !== "Envelope").length;

  const statsFor = (selection: Selection) => {
    let total = 0;
    let configured = 0;
    let changed = 0;

    const selectionPlatform: PlatformId =
      thirdPartyCollectionPlatform(selection.collectionId) ??
      (selection.collectionId.startsWith("windows")
        ? "windows"
        : selection.collectionId.startsWith("android")
          ? "android"
          : "apple");

    for (const property of selection.properties) {
      if (property.category === "Envelope") continue;
      total += 1;
      const value = selection.values[valueKey(property, selectionPlatform)];

      if (isConfiguredValue(value)) configured += 1;

      if (isChangedValue(property, value)) changed += 1;
    }

    return { total, configured, changed };
  };

  const activeStats = createMemo(() => {
    const selection = activeSelection();

    return selection ? statsFor(selection) : { total: 0, configured: 0, changed: 0 };
  });

  const inPolicy = createMemo(() => {
    const entries = searchEntries();

    return selections()
      .filter(
        (selection) =>
          !entries ||
          entries.has(selection.collectionId) ||
          isAdmxCollectionId(selection.collectionId),
      )
      .map((selection) => ({
        selection,
        stats: statsFor(selection),
        matchCount: entries?.get(selection.collectionId)?.matchKeys.size ?? 0,
      }));
  });

  const policyDraft = (): PolicyDraft => ({
    version: 2,
    name: name(),
    platforms: selectionMap(),
  });

  const issues = createMemo<ValidationIssue[]>(() => [
    ...PLATFORM_ORDER.flatMap((target) => validateDraft(draftForPlatform(policyDraft(), target))),
    ...Object.values(invalidStructured()).map((field) => ({
      severity: "error" as const,
      collectionId: field.collectionId,
      collectionName: field.collectionName,
      propertyKey: field.propertyKey,
      propertyName: field.propertyName,
      message: "Invalid structured value. Fix the JSON to save or export.",
    })),
  ]);

  const blockingIssues = createMemo(() => issues().filter((issue) => issue.severity === "error"));

  const errorCount = createMemo(
    () => issues().filter((issue) => issue.severity === "error").length,
  );

  const warningCount = createMemo(
    () => issues().filter((issue) => issue.severity === "warning").length,
  );

  const policyStats = createMemo(() => {
    let total = 0;
    let configured = 0;
    let changed = 0;

    for (const target of PLATFORM_ORDER) {
      for (const selection of selectionMap()[target] ?? []) {
        const stats = statsFor(selection);
        total += stats.total;
        configured += stats.configured;
        changed += stats.changed;
      }
    }

    return { total, configured, changed };
  });

  const issuesFor = (collectionId: string) =>
    issues().filter((issue) => issue.collectionId === collectionId);

  const fieldIssue = (collectionId: string, propertyKey: string) =>
    issues().find(
      (issue) => issue.collectionId === collectionId && issue.propertyKey === propertyKey,
    );

  const dirtySinceLoad = () => isPolicyDraftDirty(policyDraft(), initialSnapshot);

  const dirtySinceSaved = () =>
    isPolicyDraftDirty(policyDraft(), policyDraftSnapshot(savedDraft()));

  const dirty = () => (props.mode === "dashboard" ? dirtySinceSaved() : dirtySinceLoad());

  const saveStatus = () => {
    if (props.saving) return "Saving…";

    if (props.mode === "dashboard")
      return dirtySinceSaved() ? "Unsaved changes" : "Saved to policy";

    return dirtySinceLoad() ? "Unsaved draft" : "Draft saved";
  };

  // In-app navigation and tab close both go through one discard prompt. The
  // comparison is against the last saved snapshot, so opening or saving a
  // policy without edits never asks.
  const unsaved = useUnsavedChanges(() => props.mode === "dashboard" && !props.saving && dirty(), {
    title: "Discard policy changes?",
    description: "This policy has edits that have not been saved.",
  });

  // The label must describe the range delivery enforces, so it comes from the
  // same Apple `supportedOS` metadata the backend filters with.
  const [osSupport, setOsSupport] = createSignal<AppleOsSupportManifest>();

  const osRange = () => {
    const current = activeCollection();

    return current ? appleOsRangeLabel(current, osSupport()) : null;
  };

  const addCollection = (collection: Collection, template?: SelectionTemplate) => {
    const key = keyOf(collection);

    if (selected().has(key)) return false;

    // A single Apple policy is either a configuration profile or a set of DDM
    // declarations. Mixing them silently drops one half of the draft.
    if (
      platform() === "apple" &&
      collection.kind !== "profile" &&
      collection.kind !== "declaration"
    )
      return false;

    if (
      platform() === "apple" &&
      selections().some((selection) => selection.kind !== collection.kind)
    ) {
      setNotice(
        "Apple profiles and declarations are separate policies. Remove the other kind first, or start a new policy.",
      );

      return false;
    }

    // A payload Apple only supports on watchOS/tvOS/visionOS would never reach a
    // managed Mac or iPhone; adding it would show a setting that is never
    // delivered.
    if (platform() === "apple" && !appleCollectionManaged(collection.osVersions)) {
      setNotice(
        `${collection.name} is only available on ${(collection.osVersions ?? []).join(", ")}, which Mattrax does not manage.`,
      );

      return false;
    }

    const baseSelection: Selection = {
      collectionId: key,
      identifier: collection.identifier,
      kind: collection.kind,
      surface: collection.surface,
      name: collection.name,
      properties: collectionProperties(collection),
      values: defaultValues(collection),
    };

    const nextSelection: Selection = template ? { ...baseSelection, template } : baseSelection;

    setSelections((current) => [...current, nextSelection]);
    setActiveKey(key);
    setFilterQuery("");
    setFilterMode("all");
    setLiveMessage(`${collection.name} added to the policy.`);
    focusEditor();

    return true;
  };

  /**
   * Add one application from the third-party catalogue. The collection is
   * cached like a catalogue entry so the editor can render its settings.
   */
  const addThirdPartyApp = (app: ThirdPartyApp) => {
    const target = platform();
    const collection = thirdPartyAppCollection(app, target);

    if (!collection) return;
    const key = keyOf(collection);

    if (selected().has(key)) {
      selectCollection(key);

      return;
    }

    setCollections((current) => ({
      ...current,
      [collectionCacheKey(target, collection.id)]: collection,
    }));
    addCollection(collection, thirdPartySelectionTemplate(app, target));
  };

  /**
   * Add the policies selected in the ADMX review. The synthetic collections are
   * cached first so the editor can render them without a catalogue fetch.
   */
  const addAdmxImport = (items: readonly AdmxSelection[]) => {
    const target = platform();

    if (target !== "windows") return;
    const cached: Record<string, Collection> = {};
    const additions: Selection[] = [];

    for (const item of items) {
      const key = keyOf(item.collection);

      if (selections().some((selection) => selection.collectionId === key)) continue;
      cached[collectionCacheKey(target, item.collection.id)] = item.collection;
      additions.push({
        collectionId: key,
        identifier: item.collection.identifier,
        kind: item.collection.kind,
        surface: item.collection.surface,
        name: item.collection.name,
        properties: collectionProperties(item.collection),
        values: defaultValues(item.collection),
        template: item.template,
      });
    }

    if (additions.length === 0) {
      setNotice("Those ADMX policies are already in this policy.");

      return;
    }

    setCollections((current) => ({ ...current, ...cached }));
    setSelections((current) => [...current, ...additions]);
    setActiveKey(additions[0].collectionId);
    setQuery("");
    setFilterQuery("");
    setFilterMode("all");
    setMobileView("editor");
    setLiveMessage(
      `${additions.length} ADMX polic${additions.length === 1 ? "y" : "ies"} added to the policy.`,
    );
    focusEditor();
  };

  const addByKey = async (key: string, target: PlatformId = platform()) => {
    const id = collectionIdOf(key);
    const cacheKey = collectionCacheKey(target, id);
    let collection = collections()[cacheKey];

    if (!collection) {
      try {
        collection = await loadCollection(target, id);
      } catch (error) {
        setNotice(`Could not load ${key}: ${errorMessage(raisedFailure(error))}`);

        return false;
      }

      setCollections((current) => ({ ...current, [cacheKey]: collection }));
    }

    if (target !== platform()) return false;

    return addCollection(collection);
  };

  /** Add the collection open in the editor, loading it first if necessary. */
  const addActiveCollection = () => {
    const loaded = activeCollection();

    if (loaded) {
      addCollection(loaded);

      return;
    }

    const key = activeKey();

    if (!key) return;
    setLiveMessage(`Loading ${activeSummary()?.name ?? "settings"}…`);
    void addByKey(key);
  };

  const focusEditor = () =>
    queueMicrotask(() => document.getElementById("designer-editor-heading")?.focus());

  const removeSelection = (selection: Selection) => {
    setSelections((current) =>
      current.filter((item) => item.collectionId !== selection.collectionId),
    );
    setInvalidStructured((current) =>
      Object.fromEntries(
        Object.entries(current).filter(
          ([, field]) => field.collectionId !== selection.collectionId,
        ),
      ),
    );

    if (activeKey() === selection.collectionId) {
      const next = selections().find((item) => item.collectionId !== selection.collectionId);
      setActiveKey(next?.collectionId ?? null);
    }

    setRemoveTarget(null);
    setLiveMessage(`${selection.name} removed from the policy.`);
    focusEditor();
  };

  const updateValue = (key: string, property: Property, value: PolicyValue | undefined) =>
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

  const resetProperty = (key: string, property: Property) => {
    updateValue(key, property, catalogDefault(property));
    setLiveMessage(`${property.name} reset to its catalogue default.`);
  };

  const setFieldStructuredInvalid = (
    selection: Selection,
    property: Property,
    key: string,
    invalid: boolean,
  ) =>
    setInvalidStructured((current) => {
      const id = `${selection.collectionId}:${key}`;

      if (invalid === Boolean(current[id])) return current;
      const next = { ...current };

      if (invalid)
        next[id] = {
          collectionId: selection.collectionId,
          collectionName: selection.name,
          propertyKey: key,
          propertyName: property.name,
        };
      else delete next[id];

      return next;
    });

  const resetSection = (selection: Selection, properties: Property[], label: string) => {
    setSelections((current) =>
      current.map((item) => {
        if (item.collectionId !== selection.collectionId) return item;
        const values = { ...item.values };

        for (const property of properties)
          values[valueKey(property, platform())] = catalogDefault(property);

        return { ...item, values };
      }),
    );
    setLiveMessage(`${label} settings reset in ${selection.name}.`);
  };

  const applyTemplate = (keys: string[]) => {
    const target = platform();
    void (async () => {
      let added = 0;

      for (const key of keys) if (await addByKey(key, target)) added += 1;

      if (target !== platform()) return;
      setNotice(
        added === keys.length
          ? "Template applied. Tune the settings, then export or save."
          : `Applied ${added} of ${keys.length} collections; the rest were not in this catalogue.`,
      );
    })();
  };

  const applyCisTemplate = (outcome: CisTemplateOutcome) => {
    const target = outcome.template.platform;

    setSelectionMap((current) => ({ ...current, [target]: outcome.selections }));
    setCollections((current) => {
      const next = { ...current };

      for (const collection of outcome.collections)
        next[collectionCacheKey(target, collection.id)] = collection;

      return next;
    });

    if (target !== platform()) {
      setPlatform(target);
      setMobileView("editor");
    }

    const first = outcome.collections[0];

    const selection = first
      ? outcome.selections.find((candidate) => collectionIdOf(candidate.collectionId) === first.id)
      : undefined;

    setActiveKey(selection?.collectionId ?? outcome.selections[0]?.collectionId ?? null);
    setQuery("");
    setFilterQuery("");
    setFilterMode("all");
    setNotice(
      `Applied ${outcome.appliedControls} CIS control${outcome.appliedControls === 1 ? "" : "s"} from ${outcome.template.benchmark.name} (${outcome.appliedSettings} setting${outcome.appliedSettings === 1 ? "" : "s"}).`,
    );
    setLiveMessage(`${outcome.appliedControls} CIS controls applied to the ${target} policy.`);
    focusEditor();
  };

  const download = () => {
    if (policySelectionCount(policyDraft()) === 0) return;

    if (blockingIssues().length > 0) {
      setIssuesOpen(true);

      return;
    }

    try {
      const bundle = buildPolicyBundle(policyDraft());

      if (!bundle) return;
      const blob = new Blob([bundle.content], { type: bundle.contentType });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = bundle.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setNotice(`Could not export the policy: ${errorMessage(raisedFailure(error))}`);
    }
  };

  const deploy = () => {
    if (policySelectionCount(policyDraft()) === 0) return;

    if (blockingIssues().length > 0) {
      setIssuesOpen(true);
      setNotice(
        `Fix ${blockingIssues().length} validation error${blockingIssues().length === 1 ? "" : "s"} before deploying.`,
      );

      return;
    }

    try {
      localStorage.setItem("mattrax:designer-draft", JSON.stringify(policyDraft()));
    } catch {
      setNotice("Could not save the draft in this browser. Export the artifact instead.");

      return;
    }

    const returnTo = "/dashboard?designerDraft=1";
    navigate(session().data?.user ? returnTo : `/login?returnTo=${encodeURIComponent(returnTo)}`);
  };

  const canSave = () =>
    Boolean(props.onSave) &&
    policySelectionCount(policyDraft()) > 0 &&
    !props.saveDisabled &&
    !props.saving &&
    blockingIssues().length === 0;

  const disabledHint = () => {
    if (props.disabledHint) return props.disabledHint;

    if (props.saveDisabled) return "Confirm the replacement option above before saving.";

    if (policySelectionCount(policyDraft()) === 0)
      return "Add a template or a setting to get started.";

    if (blockingIssues().length > 0)
      return `Fix ${blockingIssues().length} validation error${blockingIssues().length === 1 ? "" : "s"} before saving.`;

    return null;
  };

  // A failed save must not leave the draft looking persisted: restore the
  // previous baseline so navigating away still asks before discarding.
  let baselineBeforeSave: PolicyDraft | undefined;
  createEffect(
    () => Boolean(props.error),
    (failed) => {
      if (!failed || baselineBeforeSave === undefined) return;
      setSavedDraft(baselineBeforeSave);
      baselineBeforeSave = undefined;
    },
  );
  createEffect(
    () => props.saving,
    (saving, previous) => {
      if (previous && !saving && !props.error) baselineBeforeSave = undefined;
    },
  );

  const save = () => {
    if (!canSave()) return;
    baselineBeforeSave = savedDraft();
    setSavedDraft(policyDraft());
    void props.onSave?.(policyDraft());
  };

  const designerCommands: Command[] = [
    {
      id: "policy-designer-save",
      title: "Save policy",
      subtitle: "Save the designer draft to this policy",
      group: "This page",
      icon: Check,
      shortcut: chord("s", { mod: true }),
      enabled: canSave,
      run: save,
    },
    {
      id: "policy-designer-export",
      title: "Export policy",
      subtitle: "Download the artifact bundle",
      group: "This page",
      icon: Download,
      shortcut: chord("e", { mod: true, shift: true }),
      enabled: () => policySelectionCount(policyDraft()) > 0,
      run: download,
    },
    {
      id: "policy-designer-search",
      title: "Focus setting search",
      subtitle: "Jump to the catalogue search box",
      group: "This page",
      icon: Search,
      shortcut: chord("f", { mod: true, shift: true }),
      run: () => {
        setMobileView("browse");
        queueMicrotask(() =>
          document.querySelector<HTMLInputElement>('input[aria-label="Search settings"]')?.focus(),
        );
      },
    },
    {
      id: "policy-designer-apple",
      title: "Switch to Apple",
      subtitle: "Edit the Apple selections in this policy",
      group: "This page",
      shortcut: chord("1", { alt: true }),
      run: () => choosePlatform("apple"),
    },
    {
      id: "policy-designer-windows",
      title: "Switch to Windows",
      subtitle: "Edit the Windows selections in this policy",
      group: "This page",
      shortcut: chord("2", { alt: true }),
      run: () => choosePlatform("windows"),
    },
    {
      id: "policy-designer-android",
      title: "Switch to Android",
      subtitle: "Edit the Android selections in this policy",
      group: "This page",
      shortcut: chord("3", { alt: true }),
      run: () => choosePlatform("android"),
    },
    {
      id: "policy-designer-clear",
      title: "Clear current platform settings",
      subtitle: "Remove the collections in the active platform draft",
      group: "This page",
      icon: RotateCcw,
      enabled: () => selections().length > 0,
      run: () => {
        setStartOverOpen(true);
      },
    },
  ];

  // `useCommands` is client-only, so its effect would consume a hydration id
  // the server never allocated and shift every id in the editor by one. Give
  // the effect an explicit owner id so both renders stay aligned.
  createRoot(() => useCommands(designerCommands), { id: "designer-commands" });

  const platformLabel = (id: PlatformId | null | undefined) => {
    if (!id) return "";

    return (
      manifest()?.platforms.find((item) => item.id === id)?.name ??
      id.charAt(0).toUpperCase() + id.slice(1)
    );
  };

  const platforms = (): ReadonlyArray<{ id: PlatformId; short: string }> =>
    manifest()?.platforms ?? [
      { id: "apple", short: "Apple" },
      { id: "android", short: "Android" },
      { id: "windows", short: "Windows" },
    ];

  const platformName = () => platformLabel(platform());

  const loadingLabel = () => {
    const stats = manifest()?.stats[platform()];

    return stats
      ? `Loading ${platformName()} settings — ${stats.properties.toLocaleString()} properties…`
      : `Loading ${platformName()} settings…`;
  };

  const resultLabel = () => {
    const shown = browseItems().length;

    if (query().trim()) return `${shown} matching collection${shown === 1 ? "" : "s"}`;

    return `${shown} collection${shown === 1 ? "" : "s"}`;
  };

  const selectCollection = (key: string) => {
    setActiveKey(key);
    ensureCollection(collectionIdOf(key));
    setMobileView("editor");
    setFilterQuery("");
    setFilterMode("all");
    setTimeout(() => {
      document.getElementById("designer-editor-scroll")?.scrollTo({ top: 0 });
    }, 20);
  };

  const focusIssue = (issue: ValidationIssue) => {
    setIssuesOpen(false);
    setSummaryOpen(false);
    setQuery("");
    setFilterQuery("");
    setFilterMode("all");
    setActiveKey(issue.collectionId);
    setMobileView("editor");
    ensureCollection(collectionIdOf(issue.collectionId));
    // Selections carry their own properties, so the section can be revealed
    // without waiting for the catalogue entry to load.
    const selection = selections().find((item) => item.collectionId === issue.collectionId);

    const property = selection?.properties.find(
      (item) => valueKey(item, platform()) === issue.propertyKey,
    );

    if (property) {
      const key = `${issue.collectionId}:${sectionLabel(property)}`;
      setCollapsedSections((current) => ({ ...current, [key]: false }));
    }

    setTimeout(() => {
      const rows = [...document.querySelectorAll<HTMLElement>("[data-policy-field]")];
      const row = rows.find((item) => item.dataset.policyField === issue.propertyKey);
      row?.scrollIntoView({ block: "center" });
      (
        row?.querySelector<HTMLElement>("input, select, textarea") ??
        row?.querySelector<HTMLElement>("[role='group'] button, button")
      )?.focus();
    }, 60);
  };

  const toggleGroup = (label: string) =>
    setCollapsedGroups((current) => ({ ...current, [label]: !current[label] }));

  const toggleSection = (key: string) =>
    setCollapsedSections((current) => ({ ...current, [key]: !current[key] }));

  const templateButtons = () => (
    <div class="grid gap-2">
      <For each={templateSets[platform()]}>
        {(template) => (
          <Button
            type="button"
            disabled={loading() || !data()}
            onClick={() => applyTemplate(template.keys)}
            class="w-full text-left disabled:cursor-not-allowed"
          >
            <strong class="block text-xs font-semibold">
              {template.label}
            </strong>
            <span class="mt-0.5 block text-xs text-primary-foreground/80">
              {template.description}
            </span>
            <span class="mt-2 inline-flex whitespace-nowrap rounded-full bg-brand-solid px-2 py-0.5 text-xs font-medium text-brand-foreground">
              Recommended
            </span>
          </Button>
        )}
      </For>
    </div>
  );

  const cisTemplateButton = () => (
    <Button
      type="button"
      onClick={() => setCisOpen(true)}
      class="w-full text-left"
    >
      <span class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <ShieldCheck class="size-4" />
        <strong class="text-xs font-semibold">
          Start from a CIS benchmark
        </strong>
        <Badge variant="outline" class="h-4">
          Template
        </Badge>
      </span>
      <span class="mt-0.5 block text-xs text-primary-foreground/80">
        Review a benchmark's controls, see what each maps to, and apply only the ones you want.
      </span>
    </Button>
  );

  const platformPills = () => (
    <div
      class="flex shrink-0 items-center gap-0.5 rounded-full border border-border bg-muted/60 p-0.5"
      role="group"
      aria-label="Platform"
    >
      <For each={platforms()}>
        {(item) => (
          <Button
            type="button"
            aria-pressed={platform() === item.id ? "true" : "false"}
            title={`Edit ${item.short} settings`}
            onClick={() => choosePlatform(item.id)}
            class={cn(
              "",
              platform() === item.id
                ? ""
                : "",
            )}
          >
            {item.short}
            <Show when={(selectionMap()[item.id]?.length ?? 0) > 0}>
              <span class="ml-1 tabular-nums opacity-60">{selectionMap()[item.id].length}</span>
            </Show>
          </Button>
        )}
      </For>
    </div>
  );

  const issuesButton = (compact = false) => (
    <Show when={issues().length > 0}>
      <Button
        type="button"
        onClick={() => setIssuesOpen(true)}
        class={cn(
          "inline-flex items-center",
          errorCount() > 0
            ? ""
            : "",
          compact && "",
        )}
      >
        <Show when={errorCount() > 0} fallback={<TriangleAlert class="size-3.5" />}>
          <CircleAlert class="size-3.5" />
        </Show>
        {issues().length} issue{issues().length === 1 ? "" : "s"}
      </Button>
    </Show>
  );

  const summaryPanel = () => (
    <div class="flex min-h-0 flex-1 flex-col">
      <div class="shrink-0 border-b border-border px-4 py-3">
        <h2 class="text-xs font-semibold text-foreground">Summary</h2>
        <p class="mt-0.5 text-xs text-muted-foreground">
          {policyPlatforms(policyDraft()).length} platform
          {policyPlatforms(policyDraft()).length === 1 ? "" : "s"} ·{" "}
          {policySelectionCount(policyDraft())} collection
          {policySelectionCount(policyDraft()) === 1 ? "" : "s"}
        </p>
      </div>
      <div class="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <div class="space-y-1.5">
          <p class="text-xs font-medium text-muted-foreground">
            {props.mode === "dashboard" ? "Profile name" : "Policy name"}
          </p>
          <Input
            value={name()}
            onInput={(event) => setName(event.currentTarget.value)}
            placeholder={props.mode === "dashboard" ? "Profile name" : "Policy name"}
            aria-label={props.mode === "dashboard" ? "Profile name" : "Policy name"}
            class="h-8"
          />
          <p class="text-xs leading-relaxed text-muted-foreground">
            {props.mode === "dashboard"
              ? "Shown on devices. The Mattrax policy name stays the same."
              : "Shown on devices and in the exported artifact."}
          </p>
        </div>

        <dl class="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-border bg-border">
          <div class="bg-card px-2 py-2">
            <dt class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Sets
            </dt>
            <dd class="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
              {policySelectionCount(policyDraft())}
            </dd>
          </div>
          <div class="bg-card px-2 py-2">
            <dt class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Configured
            </dt>
            <dd class="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
              {policyStats().configured}
            </dd>
          </div>
          <div class="bg-card px-2 py-2">
            <dt class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Changed
            </dt>
            <dd class="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
              {policyStats().changed}
            </dd>
          </div>
        </dl>

        <div class="space-y-2">
          <div class="flex items-center justify-between gap-2">
            <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Issues
            </h3>
            <Show when={issues().length > 0}>
              <span class="text-xs text-muted-foreground">
                {errorCount()} error{errorCount() === 1 ? "" : "s"} · {warningCount()} warning
                {warningCount() === 1 ? "" : "s"}
              </span>
            </Show>
          </div>
          <Show
            when={issues().length > 0}
            fallback={
              <p class="rounded-lg border border-border bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground">
                No validation issues. Defaults are not counted as changes.
              </p>
            }
          >
            <ul class="space-y-1">
              <For each={issues().slice(0, 40)}>
                {(issue) => (
                  <li>
                    <Button
                      type="button"
                      onClick={() => focusIssue(issue)}
                      class={cn(
                        "flex w-full items-start text-left",
                        issue.severity === "error"
                          ? ""
                          : "",
                      )}
                    >
                      <Show
                        when={issue.severity === "error"}
                        fallback={<TriangleAlert class="mt-0.5 size-3 shrink-0" />}
                      >
                        <CircleAlert class="mt-0.5 size-3 shrink-0" />
                      </Show>
                      <span class="min-w-0">
                        <span class="block truncate font-medium">{issue.propertyName}</span>
                        <span class="block truncate opacity-80">
                          {issue.collectionName} · {issue.message}
                        </span>
                      </span>
                    </Button>
                  </li>
                )}
              </For>
            </ul>
            <Show when={issues().length > 40}>
              <p class="text-xs text-muted-foreground">And {issues().length - 40} more…</p>
            </Show>
          </Show>
        </div>

        <div class="space-y-3">
          <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Collections
          </h3>
          <Show
            when={policySelectionCount(policyDraft()) > 0}
            fallback={
              <p class="text-xs text-muted-foreground">
                Add a collection from the catalogue or start from a baseline.
              </p>
            }
          >
            <For each={PLATFORM_ORDER}>
              {(target) => (
                <Show when={(selectionMap()[target]?.length ?? 0) > 0}>
                  <div class="space-y-1">
                    <Button
                      type="button"
                      onClick={() => {
                        if (platform() !== target) choosePlatform(target);
                        setSummaryOpen(false);
                      }}
                      class="flex w-full items-center justify-between text-left"
                    >
                      <span>{platformLabel(target)}</span>
                      <span class="tabular-nums">{selectionMap()[target].length}</span>
                    </Button>
                    <ul class="space-y-0.5">
                      <For each={selectionMap()[target]}>
                        {(selection) => {
                          const stats = () => statsFor(selection);

                          return (
                            <li>
                              <Button
                                type="button"
                                onClick={() => {
                                  if (platform() !== target) choosePlatform(target);
                                  selectCollection(selection.collectionId);
                                  setSummaryOpen(false);
                                }}
                                class={cn(
                                  "flex w-full items-center text-left",
                                  activeKey() === selection.collectionId && "",
                                )}
                              >
                                <span class="min-w-0 flex-1 truncate text-foreground">
                                  {selection.name}
                                </span>
                                <span class="shrink-0 tabular-nums text-muted-foreground">
                                  {stats().changed}/{stats().total}
                                </span>
                              </Button>
                            </li>
                          );
                        }}
                      </For>
                    </ul>
                  </div>
                </Show>
              )}
            </For>
          </Show>
        </div>

        <div class="space-y-2 rounded-lg border border-border bg-muted/30 p-2.5">
          <p class="text-xs leading-relaxed text-muted-foreground">
            {props.mode === "dashboard"
              ? "Saving replaces this policy's designer configuration. Policy editor settings need explicit confirmation."
              : "Export the artifact now, or deploy it into a Mattrax tenant."}
          </p>
          <Button
            type="button"
            onClick={() => setStartOverOpen(true)}
            disabled={selections().length === 0}
            class="disabled:cursor-not-allowed"
          >
            Clear {platformName()} settings
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <div class="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-page">
      {unsaved.prompt}
      <a
        href="#designer-editor"
        class="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:shadow"
      >
        Skip to settings
      </a>

      <header class="sticky top-0 z-30 shrink-0 border-b border-border bg-page/85 backdrop-blur">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 sm:px-4">
          <div class="shrink-0">{props.pageActions}</div>
          <span class="hidden h-4 w-px bg-border sm:block" aria-hidden="true" />
          <div class="flex min-w-0 items-center gap-2.5">
            <div class="min-w-0">
              <h2 class="truncate text-sm font-semibold leading-5 tracking-tight text-foreground">
                {name() || "Untitled policy"}
              </h2>
              <p class="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs leading-4 text-muted-foreground">
                <span class="truncate">
                  {policyPlatforms(policyDraft()).length} platform
                  {policyPlatforms(policyDraft()).length === 1 ? "" : "s"}
                </span>
                <span class="text-muted-foreground/40" aria-hidden="true">
                  ·
                </span>
                <span class="tabular-nums">
                  {policySelectionCount(policyDraft())} collection
                  {policySelectionCount(policyDraft()) === 1 ? "" : "s"}
                </span>
                <span class="text-muted-foreground/40" aria-hidden="true">
                  ·
                </span>
                <span
                  class={cn(
                    "inline-flex min-w-0 items-center gap-1.5",
                    props.mode === "dashboard" && dirty() && "text-warning-foreground",
                  )}
                >
                  <span
                    class={cn(
                      "size-1.5 shrink-0 rounded-full",
                      props.mode === "dashboard" && dirty() ? "bg-warning" : "bg-success",
                    )}
                    aria-hidden="true"
                  />
                  <span class="truncate">{saveStatus()}</span>
                </span>
              </p>
            </div>
          </div>

          <div class="order-3 w-full sm:order-none sm:w-auto">{platformPills()}</div>

          <div class="ml-auto flex flex-wrap items-center justify-end gap-1.5">
            <span class="hidden xl:inline-flex">{issuesButton()}</span>
            <Button size="sm" variant="outline" onClick={() => setCisOpen(true)}>
              <ShieldCheck class="mr-1 size-3.5" />
              <span class="hidden sm:inline">Apply template</span>
              <span class="sm:hidden">Template</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              class="xl:hidden"
              onClick={() => setSummaryOpen(true)}
            >
              <PanelRight class="mr-1 size-3.5" /> Summary
            </Button>
            <div class="hidden items-center gap-1.5 xl:flex">
              <Button
                size="sm"
                variant="outline"
                onClick={download}
                disabled={policySelectionCount(policyDraft()) === 0 || blockingIssues().length > 0}
                title={
                  blockingIssues().length > 0
                    ? `Fix ${blockingIssues().length} validation error${blockingIssues().length === 1 ? "" : "s"} before exporting`
                    : policySelectionCount(policyDraft()) === 0
                      ? "Add a setting to enable export"
                      : undefined
                }
              >
                <Download class="mr-1 size-3.5" /> Export
              </Button>
              <Show
                when={props.onSave}
                fallback={
                  <Button
                    size="sm"
                    onClick={deploy}
                    disabled={
                      props.canDeploy === false ||
                      policySelectionCount(policyDraft()) === 0 ||
                      blockingIssues().length > 0
                    }
                    title={
                      props.disabledHint ??
                      (props.canDeploy === false
                        ? "Your role cannot save policies"
                        : blockingIssues().length > 0
                          ? `Fix ${blockingIssues().length} validation error${blockingIssues().length === 1 ? "" : "s"} before deploying`
                          : undefined)
                    }
                  >
                    Deploy in Mattrax →
                  </Button>
                }
              >
                <Button
                  size="sm"
                  disabled={!canSave() || props.saving}
                  title={disabledHint() ?? undefined}
                  onClick={save}
                >
                  {props.saving ? "Saving…" : "Save policy"}
                </Button>
              </Show>
            </div>
          </div>
        </div>

        <Show when={disabledHint() || props.error || notice()}>
          <div class="space-y-1 px-3 pb-2 sm:px-4">
            <Show when={disabledHint()}>
              {(hint) => (
                <p class="text-right text-xs leading-relaxed text-muted-foreground">{hint()}</p>
              )}
            </Show>
            <Show when={props.error}>
              {(error) => (
                <div
                  ref={(element) => {
                    errorRef = element;
                  }}
                  role="alert"
                  class="flex w-full items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive"
                >
                  <CircleAlert class="size-3.5 shrink-0" />
                  <span class="min-w-0 flex-1 break-words">
                    {errorMessage(raisedFailure(error()))}
                  </span>
                </div>
              )}
            </Show>
            <Show when={notice()}>
              {(message) => (
                <p
                  role="status"
                  class="flex w-full items-center gap-2 rounded-lg border border-border bg-muted/30 px-2.5 py-1.5 text-xs text-foreground/90"
                >
                  <Info class="size-3.5 shrink-0" />
                  <span class="min-w-0 flex-1">{message()}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Dismiss message"
                    onClick={() => setNotice(null)}
                  >
                    <X class="size-3" />
                  </Button>
                </p>
              )}
            </Show>
          </div>
        </Show>
      </header>

      <Show when={props.mode !== "dashboard"}>
        <div class="shrink-0 border-b border-border bg-card px-4 py-2.5 sm:px-6">
          <h1 class="text-base font-semibold tracking-tight text-foreground">
            Build a policy in minutes
          </h1>
          <p class="mt-0.5 text-xs text-muted-foreground">
            Browse Apple, Windows and Android settings and export a ready-to-use artifact. No
            account is needed to export; sign in only to deploy.
          </p>
        </div>
      </Show>

      <div class="flex min-h-0 flex-1">
        <aside
          class={cn(
            "min-h-0 w-full shrink-0 flex-col border-r border-border bg-card xl:flex xl:w-72",
            mobileView() === "editor" ? "hidden xl:flex" : "flex",
          )}
          aria-label="Settings catalogue"
        >
          <div class="shrink-0 border-b border-border p-2.5">
            <div class="relative">
              <Search class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2" />
              <Input
                value={query()}
                onInput={(event) => setQuery(event.currentTarget.value)}
                placeholder="Search settings…"
                aria-label="Search settings"
                class="h-8"
              />
              <Show when={query()}>
                <Button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setQuery("")}
                  class="absolute right-1.5 top-1/2 -translate-y-1/2"
                >
                  <X class="size-3.5" />
                </Button>
              </Show>
            </div>
            <div class="mt-1.5 flex items-center justify-between gap-2">
              <p class="text-xs text-muted-foreground" aria-live="polite">
                {!data()
                  ? loadingLabel()
                  : searchIndexLoading()
                    ? "Searching settings…"
                    : resultLabel()}
              </p>
              <Show when={searchIndexErrors()[platform()]}>
                <Button
                  type="button"
                  onClick={retryCatalogue}
                  class="shrink-0"
                >
                  Search unavailable · Retry
                </Button>
              </Show>
              <Show when={deprecatedCount() > 0}>
                <label class="flex shrink-0 cursor-pointer items-center gap-1 text-xs text-muted-foreground">
                  <Checkbox
                    class="size-3"
                    checked={showDeprecated()}
                    onCheckedChange={(checked) => setShowDeprecated(checked === true)}
                  />
                  Show deprecated
                </label>
              </Show>
            </div>
          </div>

          <div class="min-h-0 flex-1 overflow-y-auto">
            <Show
              when={!catalogError()}
              fallback={
                <div class="space-y-2 p-3">
                  <p role="alert" class="text-xs text-destructive">
                    {catalogError()}
                  </p>
                  <Button size="sm" variant="outline" onClick={retryCatalogue}>
                    Retry
                  </Button>
                </div>
              }
            >
              <Show
                when={!loading()}
                fallback={<p class="p-3 text-xs text-muted-foreground">{loadingLabel()}</p>}
              >
                <section class="border-b border-border">
                  <div class="flex items-center justify-between gap-2 px-3 pb-1 pt-2.5">
                    <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      In this policy ({selections().length})
                    </h3>
                    <Show when={selections().length > 0}>
                      <Button
                        type="button"
                        variant="link"
                        size="xs"
                        onClick={() => setStartOverOpen(true)}
                      >
                        Clear
                      </Button>
                    </Show>
                  </div>
                  <Show
                    when={inPolicy().length > 0}
                    fallback={
                      <p class="px-3 pb-2.5 text-xs leading-relaxed text-muted-foreground">
                        {selections().length > 0
                          ? "No collections in this policy match the current search."
                          : "Nothing added yet. Pick a baseline or browse the catalogue."}
                      </p>
                    }
                  >
                    <ul class="pb-1">
                      <For each={inPolicy()}>
                        {(item) => {
                          const collectionIssues = () => issuesFor(item.selection.collectionId);

                          return (
                            <li
                              class={cn(
                                "group flex items-center gap-1 border-l-2 pr-1.5",
                                activeKey() === item.selection.collectionId
                                  ? "border-brand bg-muted"
                                  : "border-transparent hover:bg-muted/30",
                              )}
                            >
                              <Button
                                type="button"
                                onClick={() => selectCollection(item.selection.collectionId)}
                                class="min-w-0 flex-1 text-left"
                              >
                                <span class="flex items-center gap-1.5">
                                  <Show when={collectionIssues().length > 0}>
                                    <span
                                      class={cn(
                                        "size-1.5 shrink-0 rounded-full",
                                        collectionIssues().some(
                                          (issue) => issue.severity === "error",
                                        )
                                          ? "bg-destructive"
                                          : "bg-warning",
                                      )}
                                      title={`${collectionIssues().length} validation issue${collectionIssues().length === 1 ? "" : "s"}`}
                                    />
                                  </Show>
                                  <span class="truncate text-xs font-medium text-foreground">
                                    {item.selection.name}
                                  </span>
                                </span>
                                <span class="mt-0.5 block text-xs text-muted-foreground">
                                  {item.stats.changed}/{item.stats.total} settings
                                  <Show when={item.matchCount > 0}>
                                    {" "}
                                    · {item.matchCount} matching
                                  </Show>
                                </span>
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-xs"
                                aria-label={`Remove ${item.selection.name}`}
                                onClick={() => setRemoveTarget(item.selection)}
                              >
                                <X class="size-3.5" />
                              </Button>
                            </li>
                          );
                        }}
                      </For>
                    </ul>
                  </Show>
                </section>

                <section>
                  <div class="flex items-center justify-between px-3 pb-1 pt-2.5">
                    <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Third-party apps
                    </h3>
                    <span class="text-xs tabular-nums text-muted-foreground">
                      {thirdPartyApps().length}
                    </span>
                  </div>
                  <Show when={thirdPartyError()}>
                    {(message) => (
                      <p class="px-3 pb-2 text-xs leading-relaxed text-destructive">
                        {message()}
                      </p>
                    )}
                  </Show>
                  <Show
                    when={thirdPartyApps().length > 0}
                    fallback={
                      <p class="px-3 pb-2.5 text-xs text-muted-foreground">
                        {thirdPartyError()
                          ? "The third-party app catalogue could not be loaded."
                          : "No catalogued apps for this platform."}
                      </p>
                    }
                  >
                    <ul class="pb-1">
                      <For each={thirdPartyApps()}>
                        {(app) => {
                          const key = () =>
                            `${thirdPartyAppCollectionId(platform(), app.id)}#${app.name}`;

                          const settings = thirdPartySettingCount(app, platform());

                          return (
                            <li
                              class={cn(
                                "border-l-2",
                                activeKey() === key()
                                  ? "border-brand bg-muted"
                                  : "border-transparent hover:bg-muted/30",
                              )}
                            >
                              <Button
                                type="button"
                                onClick={() => addThirdPartyApp(app)}
                                class="flex w-full items-start text-left"
                              >
                                <span class="min-w-0 flex-1">
                                  <span class="block truncate text-xs text-foreground">
                                    {app.name}
                                  </span>
                                  <span class="mt-0.5 block truncate text-xs text-muted-foreground">
                                    {app.vendor} · {settings} managed setting
                                    {settings === 1 ? "" : "s"}
                                  </span>
                                </span>
                                <Show when={selected().has(key())}>
                                  <Check class="mt-0.5 size-3.5 shrink-0" />
                                </Show>
                              </Button>
                            </li>
                          );
                        }}
                      </For>
                    </ul>
                  </Show>
                </section>

                <Show when={platform() === "windows"}>
                  <section class="border-b border-border">
                    <div class="flex items-center justify-between gap-2 px-3 pb-1 pt-2.5">
                      <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        ADMX templates
                      </h3>
                      <Button size="xs" variant="outline" onClick={() => setAdmxOpen(true)}>
                        Import
                      </Button>
                    </div>
                    <p class="px-3 pb-2.5 text-xs leading-relaxed text-muted-foreground">
                      Import a vendor .admx/.adml pair or a .zip. Microsoft in-box templates map to
                      the settings already in the catalogue.
                    </p>
                  </section>
                </Show>

                <section>
                  <div class="flex items-center justify-between px-3 pb-1 pt-2.5">
                    <h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Browse
                    </h3>
                    <Show when={manifestError()}>
                      <Button
                        type="button"
                        variant="link"
                        size="xs"
                        onClick={retryCatalogue}
                      >
                        Retry
                      </Button>
                    </Show>
                  </div>
                  <Show
                    when={browseItems().length > 0}
                    fallback={
                      <p class="px-3 pb-3 text-xs text-muted-foreground">
                        {searchIndexLoading()
                          ? "Searching settings…"
                          : "No settings match that search."}
                      </p>
                    }
                  >
                    <For each={renderedGroups()}>
                      {(group) => (
                        <div>
                          <div class="sticky top-0 z-10 flex items-center gap-1 bg-muted/80 px-2 py-1 backdrop-blur">
                            <Button
                              type="button"
                              aria-expanded={group.collapsed ? "false" : "true"}
                              onClick={() => toggleGroup(group.label)}
                              class="flex min-w-0 flex-1 items-center text-left"
                            >
                              <ChevronDown
                                class={cn(
                                  "size-3 shrink-0",
                                  group.collapsed && "-rotate-90",
                                )}
                              />
                              <span class="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                {group.label}
                              </span>
                              <span class="shrink-0 text-xs tabular-nums text-muted-foreground">
                                {group.total}
                              </span>
                            </Button>
                          </div>
                          <ul>
                            <For each={group.items}>
                              {(item) => (
                                <li>
                                  <Button
                                    type="button"
                                    onClick={() => selectCollection(keyOf(item.collection))}
                                    class={cn(
                                      "flex w-full items-start text-left",
                                      activeKey() === keyOf(item.collection)
                                        ? ""
                                        : "",
                                    )}
                                  >
                                    <span class="min-w-0 flex-1">
                                      <span class="block truncate text-xs text-foreground">
                                        {item.collection.name}
                                      </span>
                                      <span class="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                                        <span class="truncate font-mono">
                                          {item.collection.group ?? item.collection.identifier}
                                        </span>
                                        <Show when={item.collection.deprecated}>
                                          <Badge
                                            variant="outline"
                                            class="h-4"
                                          >
                                            Deprecated
                                          </Badge>
                                        </Show>
                                      </span>
                                      <Show when={item.matchCount > 0}>
                                        <span class="mt-0.5 block text-xs text-brand">
                                          {item.matchCount} matching setting
                                          {item.matchCount === 1 ? "" : "s"}
                                        </span>
                                      </Show>
                                    </span>
                                    <Show when={selected().has(keyOf(item.collection))}>
                                      <Check class="mt-0.5 size-3.5 shrink-0" />
                                    </Show>
                                  </Button>
                                </li>
                              )}
                            </For>
                          </ul>
                        </div>
                      )}
                    </For>
                    <div class="border-t border-border p-2.5">
                      <Show
                        when={shownBrowseCount() < expandedBrowseTotal()}
                        fallback={
                          <p class="text-xs text-muted-foreground">
                            {expandedBrowseTotal()} collection
                            {expandedBrowseTotal() === 1 ? "" : "s"}
                          </p>
                        }
                      >
                        <p class="text-xs text-muted-foreground" aria-live="polite">
                          Showing {shownBrowseCount()} of {expandedBrowseTotal()}
                        </p>
                        <Button
                          size="xs"
                          variant="outline"
                          class="mt-1.5"
                          onClick={() => setVisibleCount((count) => count + SECTION_PAGE_INCREMENT)}
                        >
                          Show more
                        </Button>
                      </Show>
                    </div>
                  </Show>
                </section>
              </Show>
            </Show>
          </div>
        </aside>

        <section
          id="designer-editor"
          class={cn(
            "min-h-0 min-w-0 flex-1 flex-col bg-page xl:flex",
            mobileView() === "browse" ? "hidden xl:flex" : "flex",
          )}
          aria-label="Collection editor"
        >
          <Show
            when={activeSummary()}
            fallback={
              <div class="mx-auto h-full w-full max-w-xl overflow-y-auto px-5 py-8">
                <h2 class="text-base font-semibold tracking-tight text-foreground">
                  Start a policy
                </h2>
                <p class="mt-1 text-xs text-muted-foreground">
                  The fastest way to see a real policy. Add a baseline, then tune individual
                  settings.
                </p>
                <div class="mt-3">{cisTemplateButton()}</div>
                <div class="mt-3">{templateButtons()}</div>
                <div class="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-input px-4 py-3 text-xs text-muted-foreground">
                  <span class="min-w-0 flex-1">
                    Or search the catalogue and add settings one at a time.
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    class="xl:hidden"
                    onClick={() => setMobileView("browse")}
                  >
                    Browse settings
                  </Button>
                </div>
                <Show when={manifestError()}>
                  {(error) => (
                    <p role="alert" class="mt-3 text-xs text-destructive">
                      {error()}{" "}
                      <Button
                        type="button"
                        variant="link"
                        size="xs"
                        onClick={retryCatalogue}
                      >
                        Retry
                      </Button>
                    </p>
                  )}
                </Show>
              </div>
            }
          >
            {(collection) => (
              <>
                <div class="shrink-0 border-b border-border bg-page/90 px-3 py-2.5 backdrop-blur sm:px-5">
                  <div class="flex items-start gap-2">
                    <Button
                      type="button"
                      onClick={() => setMobileView("browse")}
                      aria-label="Back to settings list"
                      class="-ml-1 mt-0.5 xl:hidden"
                    >
                      <ArrowLeft class="size-4" />
                    </Button>
                    <div class="min-w-0 flex-1">
                      <div class="flex flex-wrap items-center gap-2">
                        <h2
                          id="designer-editor-heading"
                          tabindex="-1"
                          class="truncate text-sm font-semibold tracking-tight text-foreground focus:outline-none"
                        >
                          {collection().name}
                        </h2>
                        <Show when={collection().deprecated}>
                          <Badge variant="warning">
                            Deprecated
                          </Badge>
                        </Show>
                        <Show when={activeSelection()}>
                          <Badge variant="secondary" >
                            In policy
                          </Badge>
                        </Show>
                        <Show when={activeDocumentation()}>
                          {(href) => (
                            <DocumentationLink
                              href={href()}
                              source={platform() === "apple" ? "Apple" : "Microsoft"}
                              subject={collection().name}
                              class="h-5 px-1 text-xs"
                            />
                          )}
                        </Show>
                      </div>
                      <p class="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                        {collection().identifier}
                        <Show when={osRange()}>{(range) => <> · {range()}</>}</Show>
                        <Show when={activeCollectionLoading()}>
                          <span class="text-muted-foreground"> · Loading settings…</span>
                        </Show>
                      </p>
                    </div>
                    <div class="flex shrink-0 items-center gap-2">
                      <Show
                        when={activeSelection()}
                        fallback={
                          <Button
                            size="sm"
                            onClick={addActiveCollection}
                            disabled={Boolean(activeCollectionError())}
                            title={activeCollectionError()}
                          >
                            <Plus class="mr-1 size-3.5" /> Add to policy
                          </Button>
                        }
                      >
                        {(selection) => (
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label={`Remove ${collection().name} from policy`}
                            onClick={() => setRemoveTarget(selection())}
                          >
                            <X class="mr-1 size-3.5" /> Remove
                          </Button>
                        )}
                      </Show>
                    </div>
                  </div>

                  <Show when={activeSelection()}>
                    {(selection) => (
                      <div class="mt-2 flex flex-wrap items-center gap-2">
                        <p class="text-xs text-muted-foreground">
                          <span class="font-medium text-foreground">
                            {activeStats().changed}/{activeStats().total}
                          </span>{" "}
                          changed · {activeStats().configured} configured
                        </p>
                        <Show when={activeMatchKeys()}>
                          {(keys) => (
                            <span class="rounded-full bg-brand/10 px-2 py-0.5 text-xs text-brand">
                              {keys().size} matching setting{keys().size === 1 ? "" : "s"}
                            </span>
                          )}
                        </Show>
                        <div class="relative ml-auto min-w-36 flex-1 sm:max-w-60">
                          <Input
                            value={filterQuery()}
                            onInput={(event) => setFilterQuery(event.currentTarget.value)}
                            placeholder={`Filter ${settingCount(selection())} ${
                              settingCount(selection()) === 1 ? "setting" : "settings"
                            }`}
                            aria-label="Filter settings in this collection"
                            class="h-7"
                          />
                        </div>
                        <div
                          class="flex shrink-0 rounded-lg border border-border bg-muted/60 p-0.5"
                          role="group"
                          aria-label="Show settings"
                        >
                          <For
                            each={
                              [
                                { id: "all", label: "All" },
                                { id: "configured", label: "Configured" },
                                { id: "changed", label: "Changed" },
                              ] as const
                            }
                          >
                            {(mode) => (
                              <Button
                                type="button"
                                aria-pressed={filterMode() === mode.id ? "true" : "false"}
                                onClick={() => setFilterMode(mode.id)}
                                class={cn(
                                  "",
                                  filterMode() === mode.id
                                    ? ""
                                    : "",
                                )}
                              >
                                {mode.label}
                              </Button>
                            )}
                          </For>
                        </div>
                      </div>
                    )}
                  </Show>
                </div>

                <div
                  id="designer-editor-scroll"
                  class="designer-fields min-h-0 flex-1 overflow-y-auto"
                >
                  <Show
                    when={activeSelection()}
                    fallback={
                      <div class="mx-auto w-full max-w-2xl px-5 py-6">
                        <p class="text-xs leading-relaxed text-muted-foreground">
                          {activeCollection()?.description ||
                            (activeCollectionLoading()
                              ? "Loading this collection from the catalogue…"
                              : "This collection is not part of your policy yet.")}
                        </p>
                        <Show when={activeCollectionError()}>
                          {(error) => (
                            <p role="alert" class="mt-2 text-xs text-destructive">
                              {error()}{" "}
                              <Button
                                type="button"
                                variant="link"
                                size="xs"
                                onClick={() => ensureCollection(collectionIdOf(activeKey() ?? ""))}
                              >
                                Retry
                              </Button>
                            </p>
                          )}
                        </Show>
                        <Show when={activeCollection()}>
                          {(loaded) => {
                            const settings = () =>
                              loaded().properties.filter(
                                (property) => property.category !== "Envelope",
                              ).length;

                            return (
                              <p class="mt-3 rounded-lg border border-dashed border-input px-3 py-2.5 text-xs text-muted-foreground">
                                Add it to the policy to configure {settings().toLocaleString()}{" "}
                                {settings() === 1 ? "setting" : "settings"}.
                              </p>
                            );
                          }}
                        </Show>
                      </div>
                    }
                  >
                    {(selection) => {
                      const allProperties = () =>
                        selection().properties.filter(
                          (property) => property.category !== "Envelope",
                        );

                      const matching = () => activeMatchKeys();

                      const visibleProperties = createMemo(() => {
                        const term = filterQuery().trim().toLowerCase();
                        const matches = matching();

                        return allProperties().filter((property) => {
                          const key = valueKey(property, platform());

                          if (matches && !matches.has(key)) return false;
                          const value = selection().values[key];

                          if (filterMode() === "configured" && !isConfiguredValue(value))
                            return false;

                          if (filterMode() === "changed" && !isChangedValue(property, value))
                            return false;

                          if (
                            term &&
                            !`${property.name} ${property.key} ${property.address ?? ""} ${property.description ?? ""}`
                              .toLowerCase()
                              .includes(term)
                          )
                            return false;

                          return true;
                        });
                      });

                      const sections = createMemo(() => {
                        const groups = new Map<string, Property[]>();

                        for (const property of visibleProperties()) {
                          const label = sectionLabel(property);
                          const list = groups.get(label) ?? [];
                          list.push(property);
                          groups.set(label, list);
                        }

                        return [...groups.entries()].map(([label, properties]) => {
                          let changed = 0;

                          for (const property of properties) {
                            if (
                              isChangedValue(
                                property,
                                selection().values[valueKey(property, platform())],
                              )
                            )
                              changed += 1;
                          }

                          return { label, properties, changed };
                        });
                      });

                      return (
                        <div>
                          <Show when={activeMatchKeys()}>
                            {(keys) => (
                              <div class="flex flex-wrap items-center gap-2 border-b border-brand/20 bg-brand/[0.06] px-4 py-2 text-xs text-brand sm:px-5">
                                <Info class="size-3.5 shrink-0" />
                                Showing {keys().size} setting
                                {keys().size === 1 ? "" : "s"} matching “{query().trim()}”.
                                <Button
                                  type="button"
                                  variant="link"
                                  size="xs"
                                  onClick={() => setQuery("")}
                                >
                                  Clear search
                                </Button>
                              </div>
                            )}
                          </Show>
                          <Show
                            when={sections().length > 0}
                            fallback={
                              <div class="px-5 py-8 text-center">
                                <p class="text-xs text-muted-foreground">
                                  No settings match this filter.
                                </p>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  class="mt-2"
                                  onClick={() => {
                                    setFilterQuery("");
                                    setFilterMode("all");
                                    setQuery("");
                                  }}
                                >
                                  Clear filters
                                </Button>
                              </div>
                            }
                          >
                            <For each={sections()}>
                              {(section) => {
                                const sectionKey = () =>
                                  `${selection().collectionId}:${section.label}`;

                                const collapsed = () => Boolean(collapsedSections()[sectionKey()]);

                                return (
                                  <section aria-label={section.label}>
                                    <div class="sticky top-0 z-10 flex items-center gap-2 border-y border-border bg-muted/80 px-3 py-1.5 backdrop-blur sm:px-5">
                                      <Button
                                        type="button"
                                        aria-expanded={collapsed() ? "false" : "true"}
                                        onClick={() => toggleSection(sectionKey())}
                                        class="flex min-w-0 flex-1 items-center text-left"
                                      >
                                        <ChevronDown
                                          class={cn(
                                            "size-3.5 shrink-0",
                                            collapsed() && "-rotate-90",
                                          )}
                                        />
                                        <span class="truncate text-xs font-semibold uppercase tracking-wide text-foreground/90">
                                          {section.label}
                                        </span>
                                        <span class="shrink-0 text-xs tabular-nums text-muted-foreground">
                                          {section.changed}/{section.properties.length}
                                        </span>
                                      </Button>
                                      <Show when={section.changed > 0}>
                                        <Button
                                          type="button"
                                          aria-label={`Reset ${section.label} section`}
                                          onClick={() =>
                                            resetSection(
                                              selection(),
                                              section.properties,
                                              section.label,
                                            )
                                          }
                                          class="shrink-0"
                                        >
                                          Reset section
                                        </Button>
                                      </Show>
                                    </div>
                                    <Show when={!collapsed()}>
                                      <For each={section.properties}>
                                        {(property) => {
                                          const key = () => valueKey(property, platform());
                                          const value = () => selection().values[key()];

                                          return (
                                            <PropertyField
                                              property={property}
                                              platform={platform()}
                                              value={value()}
                                              id={fieldId(platform(), property)}
                                              documentationUrl={propertyDocumentationUrl(
                                                platform(),
                                                property,
                                                activeCollection()?.source,
                                                selection().collectionId,
                                              )}
                                              changed={isChangedValue(property, value())}
                                              searchMatch={Boolean(activeMatchKeys()?.has(key()))}
                                              issue={fieldIssue(selection().collectionId, key())}
                                              onChange={(next) =>
                                                updateValue(
                                                  selection().collectionId,
                                                  property,
                                                  next,
                                                )
                                              }
                                              onReset={() =>
                                                resetProperty(selection().collectionId, property)
                                              }
                                              onStructuredInvalid={(invalid) =>
                                                setFieldStructuredInvalid(
                                                  selection(),
                                                  property,
                                                  key(),
                                                  invalid,
                                                )
                                              }
                                            />
                                          );
                                        }}
                                      </For>
                                    </Show>
                                  </section>
                                );
                              }}
                            </For>
                            <Show when={selection().kind === "declaration"}>
                              <p class="border-t border-border/60 px-4 py-3 text-xs text-muted-foreground sm:px-5">
                                Type, identifier and server token are generated when you export or
                                save.
                              </p>
                            </Show>
                          </Show>
                        </div>
                      );
                    }}
                  </Show>
                </div>
              </>
            )}
          </Show>
        </section>

        <aside
          class="hidden min-h-0 w-78 shrink-0 flex-col border-l border-border bg-card xl:flex"
          aria-label="Policy summary"
        >
          {summaryPanel()}
        </aside>
      </div>

      <div class="fixed inset-x-0 bottom-0 z-40 flex items-center gap-2 border-t border-border bg-page/95 px-3 py-2 backdrop-blur xl:hidden">
        <div class="min-w-0 flex-1 text-xs text-muted-foreground">
          <p class="truncate">
            {selections().length} collection{selections().length === 1 ? "" : "s"} ·{" "}
            {policyStats().changed} changed
          </p>
          <div class="mt-0.5 flex items-center gap-2">
            {issuesButton(true)}
            <MakeIssuesSummary issues={issues().length} errors={errorCount()} />
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={download}
          disabled={policySelectionCount(policyDraft()) === 0 || blockingIssues().length > 0}
        >
          Export
        </Button>
        <Show
          when={props.onSave}
          fallback={
            <Button
              size="sm"
              onClick={deploy}
              disabled={policySelectionCount(policyDraft()) === 0 || blockingIssues().length > 0}
            >
              Deploy
            </Button>
          }
        >
          <Button size="sm" disabled={!canSave() || props.saving} onClick={save}>
            {props.saving ? "Saving…" : "Save policy"}
          </Button>
        </Show>
      </div>
      <div class="h-14.25 shrink-0 xl:hidden" aria-hidden="true" />

      <p role="status" aria-live="polite" class="sr-only">
        {liveMessage()}
      </p>

      {/* Remove a collection */}
      <Dialog
        open={removeTarget() !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
      >
        <DialogContent class="max-w-md">
          <DialogHeader>
            <DialogTitle>Remove {removeTarget()?.name}?</DialogTitle>
            <DialogDescription>
              {removeTarget()
                ? `This collection and its ${statsFor(removeTarget()!).configured} configured setting${
                    statsFor(removeTarget()!).configured === 1 ? "" : "s"
                  } will be removed from this policy. Export first if you need a copy.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter class="mt-4 flex-row justify-end">
            <Button variant="outline" onClick={() => setRemoveTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const target = removeTarget();

                if (target) removeSelection(target);
              }}
            >
              Remove from policy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Start over */}
      <Dialog open={startOverOpen()} onOpenChange={setStartOverOpen}>
        <DialogContent class="max-w-md">
          <DialogHeader>
            <DialogTitle>Start over?</DialogTitle>
            <DialogDescription>
              This clears every collection and setting in the current {platformName()} draft.
              {props.mode === "dashboard"
                ? " Settings already saved to the policy are not changed until you save."
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter class="mt-4 flex-row justify-end">
            <Button variant="outline" onClick={() => setStartOverOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setSelections(() => []);
                setInvalidStructured({});
                setActiveKey(null);
                setStartOverOpen(false);
                setLiveMessage("The draft was cleared.");
              }}
            >
              Clear draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Review issues */}
      <Dialog open={issuesOpen()} onOpenChange={setIssuesOpen}>
        <DialogContent class="max-h-4/5 max-w-2xl overflow-hidden">
          <DialogHeader>
            <DialogTitle>Review issues</DialogTitle>
            <DialogDescription>
              {errorCount()} error{errorCount() === 1 ? "" : "s"} block saving and exporting.{" "}
              {warningCount()} warning{warningCount() === 1 ? "" : "s"} should be reviewed.
            </DialogDescription>
          </DialogHeader>
          <ul class="mt-3 max-h-1/2 space-y-1 overflow-y-auto">
            <For each={issues()}>
              {(issue) => (
                <li>
                  <Button
                    type="button"
                    onClick={() => focusIssue(issue)}
                    class={cn(
                      "flex w-full items-start text-left",
                      issue.severity === "error"
                        ? ""
                        : "",
                    )}
                  >
                    <Show
                      when={issue.severity === "error"}
                      fallback={<TriangleAlert class="mt-0.5 size-4 shrink-0" />}
                    >
                      <CircleAlert class="mt-0.5 size-4 shrink-0" />
                    </Show>
                    <span class="min-w-0">
                      <span class="block font-medium">{issue.propertyName}</span>
                      <span class="block text-xs opacity-80">
                        {issue.collectionName} · {issue.message}
                      </span>
                    </span>
                  </Button>
                </li>
              )}
            </For>
          </ul>
          <DialogFooter class="mt-4 flex-row justify-end">
            <Button variant="outline" onClick={() => setIssuesOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AdmxImportDialog open={admxOpen()} onOpenChange={setAdmxOpen} onImport={addAdmxImport} />

      <CisTemplateDialog
        open={cisOpen()}
        platform={platform()}
        selections={selections()}
        onOpenChange={setCisOpen}
        onApply={applyCisTemplate}
      />

      {/* Summary sheet below xl */}
      <Sheet open={summaryOpen()} onOpenChange={setSummaryOpen}>
        <Show when={summaryOpen()}>
          <SheetContent side="right" class="w-90 max-w-svw">
            <SheetHeader class="sr-only">
              <SheetTitle>Policy summary</SheetTitle>
              <SheetDescription>Review collections, issues and save this policy.</SheetDescription>
            </SheetHeader>
            {summaryPanel()}
          </SheetContent>
        </Show>
      </Sheet>
    </div>
  );
}

function MakeIssuesSummary(props: { issues: number; errors: number }) {
  return (
    <Show when={props.issues === 0}>
      <span class="text-xs text-muted-foreground">No issues</span>
    </Show>
  );
}

type PropertyFieldProps = {
  property: Property;
  platform: PlatformId;
  value: PolicyValue | undefined;
  id: string;
  documentationUrl?: string;
  changed: boolean;
  searchMatch: boolean;
  issue?: ValidationIssue;
  onChange: (value: PolicyValue | undefined) => void;
  onReset: () => void;
  onStructuredInvalid?: (invalid: boolean) => void;
};

function PropertyField(props: PropertyFieldProps) {
  const descId = () => `${props.id}-description`;
  const hintId = () => `${props.id}-hint`;
  const errorId = () => `${props.id}-error`;
  const isBoolean = () => props.property.type === "boolean" && !props.property.enum;
  const arrayEnumValues = () => (props.property.type === "array" ? props.property.enum : undefined);
  const enumValues = () => (props.property.type !== "array" ? props.property.enum : undefined);
  const groupedControl = () => isBoolean() || Boolean(arrayEnumValues());

  const isStructured = () =>
    ["array", "dictionary", "data"].includes(props.property.type) && !arrayEnumValues();

  const [structuredInvalid, setStructuredInvalid] = createSignal(false);
  const rowInvalid = () => invalid() || (isStructured() && structuredInvalid());
  createEffect(
    () => isStructured() && structuredInvalid(),
    (invalid) => {
      props.onStructuredInvalid?.(invalid);
    },
  );
  const [showDescription, setShowDescription] = createSignal(false);

  const descriptionVisible = () =>
    props.changed || props.searchMatch || Boolean(props.issue) || showDescription();

  const describedBy = () =>
    [descId(), hintId(), props.issue ? errorId() : undefined].filter(Boolean).join(" ");

  const invalid = () => props.issue?.severity === "error";

  /**
   * The catalogue serializes enum options as strings even for on/off and
   * numeric CSPs. Use the option domain (not just the default) so the stored
   * value keeps the type the plist/SyncML payload expects.
   */
  const enumKind = () => {
    const values = enumValues()?.map((option) => option.value) ?? [];

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

  const arrayValue = () => (Array.isArray(props.value) ? props.value : []);

  const toggleArrayValue = (option: string, checked: boolean) => {
    const current = arrayValue().map(String);
    props.onChange(
      checked
        ? [...current.filter((value) => value !== option), option]
        : current.filter((value) => value !== option),
    );
  };

  const [optionQuery, setOptionQuery] = createSignal("");

  const visibleOptions = () => {
    const term = optionQuery().trim().toLowerCase();

    return (arrayEnumValues() ?? []).filter(
      (option) =>
        !term || `${option.description ?? ""} ${option.value}`.toLowerCase().includes(term),
    );
  };

  const selectAllOptions = () => {
    const values = (arrayEnumValues() ?? []).map((option) => option.value);
    props.onChange([...new Set([...arrayValue().map(String), ...values])]);
  };

  return (
    <div
      data-policy-field={valueKey(props.property, props.platform)}
      class={cn(
        "designer-field relative flex flex-col gap-2 border-b border-border/60 px-4 py-3 last:border-b-0",
        rowInvalid() && "bg-destructive/[0.05]",
      )}
    >
      <Show when={props.changed}>
        <span class="absolute inset-y-0 left-0 w-0.5 bg-brand-solid" aria-hidden="true" />
      </Show>
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Show
            when={groupedControl()}
            fallback={
              <label for={props.id} class="text-xs font-medium text-foreground">
                {props.property.name}
              </label>
            }
          >
            <span class="text-xs font-medium text-foreground">{props.property.name}</span>
          </Show>
          <Show when={props.property.required}>
            <span class="text-xs font-medium uppercase tracking-wide text-destructive">
              Required
            </span>
          </Show>
          <Show when={props.changed}>
            <Badge variant="secondary" class="h-4">
              Changed
            </Badge>
          </Show>
          <Show when={props.property.deprecated}>
            <Badge
              variant="outline"
              class="h-4"
            >
              Deprecated
            </Badge>
          </Show>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => setShowDescription((value) => !value)}
            aria-expanded={showDescription() ? "true" : "false"}
            aria-controls={descId()}
            aria-label={`${showDescription() ? "Hide" : "Show"} description for ${props.property.name}`}
          >
            <Info class="size-3.5" />
          </Button>
          <Show when={props.changed}>
            <Button
              type="button"
              onClick={props.onReset}
              aria-label={`Reset ${props.property.name} to its default`}
              class="ml-auto inline-flex items-center"
            >
              <RotateCcw class="size-3" /> Reset
            </Button>
          </Show>
        </div>
        <p
          id={descId()}
          class={cn(
            "mt-1 text-xs leading-relaxed text-muted-foreground",
            !descriptionVisible() && "sr-only",
          )}
        >
          {props.property.description || "No description in the catalogue."}
        </p>
        <div
          id={hintId()}
          class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground"
        >
          <span class="max-w-full truncate font-mono text-xs text-muted-foreground">
            {props.property.address ?? props.property.key}
          </span>
          <span aria-hidden="true">·</span>
          <span>{typeLabel(props.property.type)}</span>
          <Show when={catalogDefault(props.property) !== undefined}>
            <span>
              Default:{" "}
              <span class="text-foreground/90">{formatValue(catalogDefault(props.property))}</span>
            </span>
          </Show>
          <Show when={props.property.min !== undefined || props.property.max !== undefined}>
            <span>
              Min {props.property.min ?? "—"} · Max {props.property.max ?? "—"}
            </span>
          </Show>
          <Show when={props.property.pattern}>
            {(pattern) => (
              <span class="max-w-full truncate font-mono text-xs">Pattern: {pattern()}</span>
            )}
          </Show>
          <Show when={props.searchMatch}>
            <span class="text-brand">Matches search</span>
          </Show>
          <Show when={props.documentationUrl}>
            {(href) => (
              <DocumentationLink
                href={href()}
                source="Microsoft"
                subject={props.property.name}
                class="h-5 px-1 text-xs"
              />
            )}
          </Show>
        </div>
        <Show when={props.issue}>
          {(issue) => (
            <p
              id={errorId()}
              class={cn(
                "mt-1 text-xs",
                issue().severity === "error" ? "text-destructive" : "text-warning-foreground",
              )}
            >
              {issue().message}
            </p>
          )}
        </Show>
      </div>

      <div class="designer-field-control w-full shrink-0">
        <Show when={enumValues()}>
          {(values) => (
            <select
              id={props.id}
              class="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-xs text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 aria-invalid:border-destructive/60"
              value={props.value === undefined ? "" : String(props.value)}
              aria-required={props.property.required ? "true" : undefined}
              aria-invalid={invalid() ? "true" : undefined}
              aria-describedby={describedBy()}
              onChange={(event) => {
                const next = event.currentTarget.value;
                props.onChange(next === "" ? undefined : coerce(next));
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
            <div class="space-y-1.5">
              <Show when={values().length > 8}>
                <Input
                  value={optionQuery()}
                  onInput={(event) => setOptionQuery(event.currentTarget.value)}
                  placeholder="Filter options…"
                  aria-label={`Filter ${props.property.name} options`}
                  class="h-7"
                />
              </Show>
              <div class="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{arrayValue().length} selected</span>
                <span class="flex gap-2">
                  <Button
                    type="button"
                    variant="link"
                    size="xs"
                    onClick={selectAllOptions}
                  >
                    Select all
                  </Button>
                  <Button
                    type="button"
                    variant="link"
                    size="xs"
                    onClick={() => props.onChange([])}
                  >
                    None
                  </Button>
                </span>
              </div>
              <div
                id={props.id}
                role="group"
                aria-label={props.property.name}
                aria-describedby={describedBy()}
                class={cn(
                  "max-h-52 space-y-0.5 overflow-y-auto rounded-lg border bg-muted/20 p-1.5",
                  invalid() ? "border-destructive/60" : "border-input",
                )}
              >
                <For
                  each={visibleOptions()}
                  fallback={
                    <p class="px-1 py-2 text-xs text-muted-foreground">No options match.</p>
                  }
                >
                  {(option) => (
                    <label class="flex items-start gap-2 rounded px-1 py-0.5 text-xs leading-snug text-foreground/90 hover:bg-muted/30">
                      <Checkbox
                        class="mt-0.5 size-3.5"
                        checked={arrayValue().includes(option.value)}
                        onCheckedChange={(checked) =>
                          toggleArrayValue(option.value, checked === true)
                        }
                      />
                      <span>{option.description ?? option.value}</span>
                    </label>
                  )}
                </For>
              </div>
            </div>
          )}
        </Show>

        <Show when={isBoolean()}>
          <div
            id={props.id}
            role="group"
            aria-label={props.property.name}
            aria-describedby={describedBy()}
            class="flex w-full rounded-lg border border-input bg-muted/30 p-0.5"
          >
            <For
              each={[
                { label: "Not set", value: undefined },
                { label: "On", value: true },
                { label: "Off", value: false },
              ]}
            >
              {(option) => {
                const pressed = () =>
                  option.value === undefined
                    ? props.value === undefined
                    : props.value === option.value;

                return (
                  <Button
                    type="button"
                    aria-pressed={pressed() ? "true" : "false"}
                    onClick={() => props.onChange(option.value)}
                    class={cn(
                      "flex-1",
                      pressed()
                        ? ""
                        : "",
                    )}
                  >
                    {option.label}
                  </Button>
                );
              }}
            </For>
          </div>
        </Show>

        <Show when={isStructured()}>
          <StructuredField
            property={props.property}
            value={props.value}
            id={props.id}
            describedBy={describedBy()}
            invalid={invalid()}
            onInvalidChange={setStructuredInvalid}
            onChange={props.onChange}
          />
        </Show>

        <Show when={!props.property.enum && props.property.type === "integer"}>
          <Input
            id={props.id}
            type="number"
            step="1"
            min={props.property.min}
            max={props.property.max}
            value={props.value === undefined ? "" : String(props.value)}
            aria-required={props.property.required ? "true" : undefined}
            aria-invalid={invalid() ? "true" : undefined}
            aria-describedby={describedBy()}
            onInput={(event) => {
              const value = event.currentTarget.value;
              const number = value === "" ? undefined : Number(value);

              if (number === undefined || Number.isFinite(number)) props.onChange(number);
            }}
          />
        </Show>

        <Show when={!props.property.enum && props.property.type === "real"}>
          <Input
            id={props.id}
            type="number"
            step="any"
            min={props.property.min}
            max={props.property.max}
            value={props.value === undefined ? "" : String(props.value)}
            aria-required={props.property.required ? "true" : undefined}
            aria-invalid={invalid() ? "true" : undefined}
            aria-describedby={describedBy()}
            onInput={(event) => {
              const value = event.currentTarget.value;
              const number = value === "" ? undefined : Number(value);

              if (number === undefined || Number.isFinite(number)) props.onChange(number);
            }}
          />
        </Show>

        <Show when={!props.property.enum && props.property.type === "date"}>
          <Input
            id={props.id}
            type="date"
            value={props.value === undefined ? "" : String(props.value).slice(0, 10)}
            aria-required={props.property.required ? "true" : undefined}
            aria-invalid={invalid() ? "true" : undefined}
            aria-describedby={describedBy()}
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
            id={props.id}
            value={props.value === undefined ? "" : String(props.value)}
            aria-required={props.property.required ? "true" : undefined}
            aria-invalid={invalid() ? "true" : undefined}
            aria-describedby={describedBy()}
            onInput={(event) => {
              const value = event.currentTarget.value;
              // An empty optional text field means "not configured", not an
              // explicit empty string in the artifact.
              props.onChange(value === "" ? undefined : value);
            }}
          />
        </Show>
      </div>
    </div>
  );
}

function StructuredField(props: {
  property: Property;
  value: PolicyValue | undefined;
  id: string;
  describedBy: string;
  invalid: boolean;
  onInvalidChange: (invalid: boolean) => void;
  onChange: (value: PolicyValue | undefined) => void;
}) {
  const isData = () => props.property.type === "data";

  const format = (value: PolicyValue | undefined) => {
    if (value === undefined || value === null) return "";

    if (isData()) return isString(value) ? value : String(value);

    if (isString(value)) return value;

    return JSON.stringify(value, null, 2);
  };

  const [text, setText] = createSignal(format(props.value));
  const [error, setError] = createSignal<string | null>(null);
  let lastIncoming: PolicyValue | undefined;
  let hasIncoming = false;

  createEffect(
    () => props.value,
    (incoming) => {
      if (hasIncoming && sameValue(incoming, lastIncoming)) return;
      hasIncoming = true;
      lastIncoming = incoming;
      setText(format(incoming));
      setError(null);
      props.onInvalidChange(false);
    },
  );

  const handleInput = (raw: string) => {
    setText(raw);

    if (isData()) {
      lastIncoming = raw;
      setError(null);
      props.onInvalidChange(false);
      props.onChange(raw === "" ? undefined : raw);

      return;
    }

    if (raw.trim() === "") {
      lastIncoming = undefined;
      setError(null);
      props.onInvalidChange(false);
      props.onChange(undefined);

      return;
    }

    try {
      const parsed = Option.getOrUndefined(decodeJson(JSON.parse(raw)));

      if (parsed === undefined) {
        setError("Expected a JSON value.");
        props.onInvalidChange(true);

        return;
      }

      if (props.property.type === "array" && !Array.isArray(parsed)) {
        setError('Expected a JSON list, for example ["value"].');
        props.onInvalidChange(true);

        return;
      }

      if (props.property.type === "dictionary" && !isJsonObject(parsed)) {
        setError('Expected a JSON object, for example {"key": "value"}.');
        props.onInvalidChange(true);

        return;
      }

      lastIncoming = parsed;
      setError(null);
      props.onInvalidChange(false);
      props.onChange(parsed);
    } catch {
      setError("Invalid JSON. The last valid value is kept until this is fixed.");
      props.onInvalidChange(true);
    }
  };

  return (
    <div class="space-y-1">
      <textarea
        id={props.id}
        value={text()}
        onInput={(event) => handleInput(event.currentTarget.value)}
        spellcheck={false}
        aria-invalid={props.invalid || Boolean(error()) ? "true" : undefined}
        aria-describedby={
          [props.describedBy, error() ? `${props.id}-json-error` : undefined]
            .filter(Boolean)
            .join(" ") || undefined
        }
        class={cn(
          "min-h-24 w-full rounded-lg border border-input bg-background p-2 font-mono text-xs leading-relaxed text-foreground outline-none transition-colors focus-visible:ring-2",
          props.invalid || error()
            ? "border-destructive/60 focus-visible:border-destructive focus-visible:ring-destructive/30"
            : "border-input focus-visible:border-ring focus-visible:ring-ring/30",
        )}
      />
      <Show when={error()}>
        {(message) => (
          <p id={`${props.id}-json-error`} class="text-xs text-destructive">
            {message()}
          </p>
        )}
      </Show>
      <p class="text-xs text-muted-foreground">
        {isData() ? "Base64 data — pasted text is stored as-is." : "Advanced JSON"}
      </p>
    </div>
  );
}
