import { useNavigate } from "@solidjs/router";
import type { JSX } from "@solidjs/web";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "~/components/ui/sheet";
import { authClient } from "~/lib/auth";
import { errorMessage } from "~/lib/errors";
import {
  collectionProperties,
  loadCollection,
  loadManifest,
  loadPlatformIndex,
  loadSearchIndex,
  resetPlatformCache,
  searchIndexProperties,
  type CatalogManifest,
  type Collection,
  type CollectionSummary,
  type PlatformId,
  type PlatformIndex,
  type Property,
  type SearchIndex,
  typeLabel,
} from "~/lib/policy-designer/catalog";
import {
  buildArtifact,
  catalogDefault,
  defaultValues,
  isChangedValue,
  isConfiguredValue,
  sameValue,
  validateDraft,
  valueKey,
  type Draft,
  type Selection,
  type ValidationIssue,
} from "~/lib/policy-designer/build";

import { cn } from "~/lib/utils";

const keyOf = (collection: { id: string; name: string }) => `${collection.id}#${collection.name}`;

/** Selections store `${collection.id}#${collection.name}`; loaders need just the id. */
const collectionIdOf = (selectionId: string) => selectionId.split("#")[0] ?? selectionId;

const safeId = (value: string) => value.replace(/[^A-Za-z0-9_-]+/g, "-");

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

const formatValue = (value: unknown) => {
  if (value === undefined) return "Not set";
  if (value === null) return "Empty";
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (Array.isArray(value)) return value.length === 0 ? "Empty list" : JSON.stringify(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const relativeTime = (timestamp: number, now: number) => {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 15) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
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

const parseStoredDraft = (value: string | null): Draft | undefined => {
  if (!value) return undefined;
  try {
    const draft = JSON.parse(value) as Draft;
    return draft.version === 1 && Array.isArray(draft.selections) ? draft : undefined;
  } catch {
    return undefined;
  }
};

const serializeDraft = (draft: Draft) =>
  JSON.stringify({ platform: draft.platform, name: draft.name, selections: draft.selections });

const SECTION_PAGE = 60;
const SECTION_PAGE_INCREMENT = 40;

export type PolicyDesignerProps = {
  readonly mode?: "public" | "dashboard";
  readonly initialDraft?: Draft;
  /** The draft currently persisted on the policy, used for honest save status. */
  readonly persistedDraft?: Draft;
  /** Saved designer drafts per platform, so switching platforms rehydrates them. */
  readonly platformDrafts?: Partial<Record<PlatformId, Draft>>;
  readonly saving?: boolean;
  readonly saveDisabled?: boolean;
  readonly error?: unknown;
  readonly storageKey?: string;
  readonly onSave?: (draft: Draft) => Promise<void> | void;
  /** Optional page-level links rendered in the compact top bar. */
  readonly pageActions?: JSX.Element;
  /** Reports platform changes so a parent can warn about saved configurations. */
  readonly onPlatformChange?: (platform: PlatformId) => void;
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
    ...(initialDraft ? { [initialDraft.platform]: initialDraft.selections } : {}),
  });
  const [notice, setNotice] = createSignal<string | null>(null);
  const [liveMessage, setLiveMessage] = createSignal("");
  const [savedAt, setSavedAt] = createSignal<number | null>(initialDraft?.savedAt ?? null);
  const [clock, setClock] = createSignal(Date.now());
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
  const [previewOpen, setPreviewOpen] = createSignal(false);
  const [startOverOpen, setStartOverOpen] = createSignal(false);
  const [pendingPlatform, setPendingPlatform] = createSignal<PlatformId | null>(null);
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

  const initialSnapshot = untrack(() =>
    serializeDraft({
      version: 1,
      platform: platform(),
      name: name(),
      selections: selectionMap()[platform()] ?? [],
    }),
  );

  const data = () => indexes()[platform()] ?? null;
  const catalogError = () => indexErrors()[platform()] ?? null;
  // A platform is loading until its index has arrived or failed.
  const loading = () => !data() && !catalogError();

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
      setLoadingCollections((current) => ({ ...current, [cacheKey]: true }));
      setCollectionErrors((current) => {
        if (!(cacheKey in current)) return current;
        const next = { ...current };
        delete next[cacheKey];
        return next;
      });
      void loadCollection(targetPlatform, collectionId)
        .then((collection) => setCollections((current) => ({ ...current, [cacheKey]: collection })))
        .catch((error) =>
          setCollectionErrors((current) => ({ ...current, [cacheKey]: errorMessage(error) })),
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
    if (force) resetPlatformCache(target);
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
      .catch((error) => {
        if (requestIds.get(target) !== id) return;
        setIndexErrors((current) => ({ ...current, [target]: errorMessage(error) }));
      });
  };

  const retryCatalogue = () => {
    setManifestError(null);
    if (!manifest())
      void loadManifest()
        .then(setManifest)
        .catch((error) => setManifestError(errorMessage(error)));
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

  const applyPlatform = (next: PlatformId, discard: boolean) => {
    if (discard) {
      const current = platform();
      setSelectionMap((value) => ({ ...value, [current]: [] }));
      setInvalidStructured({});
      setActiveKey(null);
      setLiveMessage(`Switched to ${platformLabel(next)}. Previous selections were discarded.`);
    }
    setPendingPlatform(null);
    setPlatform(next);
    const saved = props.platformDrafts?.[next];
    if (saved && (selectionMap()[next]?.length ?? 0) === 0) {
      setSelectionMap((value) => ({ ...value, [next]: saved.selections }));
      setActiveKey(saved.selections[0]?.collectionId ?? null);
      if (saved.selections.length > 0)
        setNotice(`Loaded the saved ${platformLabel(next)} settings from this policy.`);
    } else {
      setActiveKey(null);
    }
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
    if (selections().length > 0) {
      setPendingPlatform(next);
      return;
    }
    applyPlatform(next, false);
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
      .catch((error) => setManifestError(errorMessage(error)));

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

    const ticker = setInterval(() => setClock(Date.now()), 30_000);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const dirty = props.mode === "dashboard" ? dirtySincePolicy() : dirtySinceLoad();
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    if (props.mode === "dashboard") window.addEventListener("beforeunload", beforeUnload);

    return () => {
      clearInterval(ticker);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  });

  // Autosave drafts so the “design before sign-up” promise is real. The short
  // delay keeps a large Windows draft off the typing path.
  let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(autosaveTimer));
  createEffect(
    () => ({ platform: platform(), name: name(), selections: selections() }),
    (value) => {
      clearTimeout(autosaveTimer);
      // Do not rewrite the browser draft merely because the editor mounted.
      // Stamping a fresh `savedAt` on load made stale drafts look newer than
      // the policy and silently override it.
      if (serializeDraft({ version: 1, ...value }) === initialSnapshot) return;
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

  // Restore the last active collection (or the first one) when the catalogue
  // arrives, instead of greeting a configured policy with an empty state.
  createEffect(
    () => ({ data: data(), active: activeKey(), selections: selections() }),
    (value) => {
      if (!value.data) return;
      if (
        value.active &&
        value.data.collections.some((collection) => keyOf(collection) === value.active)
      ) {
        ensureCollection(collectionIdOf(value.active));
        return;
      }
      const first = value.selections[0];
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
          .catch((error) =>
            setSearchIndexErrors((current) => ({
              ...current,
              [value.platform]: errorMessage(error),
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
    return key ? data()?.collections.find((collection) => keyOf(collection) === key) : undefined;
  });
  const activeCollection = createMemo<Collection | undefined>(() => {
    const key = activeKey();
    return key ? collections()[collectionCacheKey(platform(), collectionIdOf(key))] : undefined;
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
    for (const property of selection.properties) {
      if (property.category === "Envelope") continue;
      total += 1;
      const value = selection.values[valueKey(property, platform())];
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
      .filter((selection) => !entries || entries.has(selection.collectionId))
      .map((selection) => ({
        selection,
        stats: statsFor(selection),
        matchCount: entries?.get(selection.collectionId)?.matchKeys.size ?? 0,
      }));
  });

  const draft = (): Draft => ({
    version: 1,
    platform: platform(),
    name: name(),
    selections: selections(),
  });

  const issues = createMemo<ValidationIssue[]>(() => [
    ...validateDraft(draft()),
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
    for (const selection of selections()) {
      const stats = statsFor(selection);
      total += stats.total;
      configured += stats.configured;
      changed += stats.changed;
    }
    return { total, configured, changed };
  });

  const issuesFor = (collectionId: string) =>
    issues().filter((issue) => issue.collectionId === collectionId);
  const fieldIssue = (collectionId: string, propertyKey: string) =>
    issues().find(
      (issue) => issue.collectionId === collectionId && issue.propertyKey === propertyKey,
    );

  const dirtySinceLoad = () => serializeDraft(draft()) !== initialSnapshot;
  const dirtySincePolicy = () =>
    props.persistedDraft === undefined ||
    serializeDraft(draft()) !== serializeDraft(props.persistedDraft);

  const browserSavedLabel = () => {
    const at = savedAt();
    if (!at) return "Autosaves in this browser";
    return `Saved to this browser · ${relativeTime(at, clock())}`;
  };
  const saveStatus = () => {
    if (props.saving) return "Saving to policy…";
    if (props.mode === "dashboard") {
      if (!dirtySincePolicy()) return "Saved to policy";
      return `${browserSavedLabel()} · not saved to policy`;
    }
    return browserSavedLabel();
  };

  const addCollection = (collection: Collection) => {
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
    setFilterQuery("");
    setFilterMode("all");
    setLiveMessage(`${collection.name} added to the policy.`);
    focusEditor();
    return true;
  };

  const addByKey = async (key: string, target: PlatformId = platform()) => {
    const id = collectionIdOf(key);
    const cacheKey = collectionCacheKey(target, id);
    let collection = collections()[cacheKey];
    if (!collection) {
      try {
        collection = await loadCollection(target, id);
      } catch (error) {
        setNotice(`Could not load ${key}: ${errorMessage(error)}`);
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

  const download = () => {
    if (selections().length === 0) return;
    if (blockingIssues().length > 0) {
      setIssuesOpen(true);
      setNotice(
        `Fix ${blockingIssues().length} validation error${blockingIssues().length === 1 ? "" : "s"} before exporting.`,
      );
      return;
    }
    try {
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
    } catch (error) {
      setNotice(`Could not export the policy: ${errorMessage(error)}`);
    }
  };

  const deploy = () => {
    if (selections().length === 0) return;
    if (blockingIssues().length > 0) {
      setIssuesOpen(true);
      setNotice(
        `Fix ${blockingIssues().length} validation error${blockingIssues().length === 1 ? "" : "s"} before deploying.`,
      );
      return;
    }
    try {
      localStorage.setItem("mattrax:designer-draft", JSON.stringify(draft()));
    } catch {
      setNotice("Could not save the draft in this browser. Export the artifact instead.");
      return;
    }
    const returnTo = "/dashboard?designerDraft=1";
    navigate(session().data?.user ? returnTo : `/login?returnTo=${encodeURIComponent(returnTo)}`);
  };

  const canSave = () =>
    Boolean(props.onSave) &&
    selections().length > 0 &&
    !props.saveDisabled &&
    blockingIssues().length === 0;
  const disabledHint = () => {
    if (props.saveDisabled) return "Confirm the replacement option above before saving.";
    if (selections().length === 0) return "Add a template or a setting to get started.";
    if (blockingIssues().length > 0)
      return `Fix ${blockingIssues().length} validation error${blockingIssues().length === 1 ? "" : "s"} before saving.`;
    return null;
  };

  const save = () => {
    if (!canSave()) return;
    void props.onSave?.(draft());
  };

  const platformLabel = (id: PlatformId | null | undefined) => {
    if (!id) return "";
    return (
      manifest()?.platforms.find((item) => item.id === id)?.name ??
      id.charAt(0).toUpperCase() + id.slice(1)
    );
  };
  const platforms = (): Array<{ id: PlatformId; short: string }> =>
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
          <button
            type="button"
            disabled={loading() || !data()}
            onClick={() => applyTemplate(template.keys)}
            class="w-full rounded-xl border border-stone-200 bg-white p-3 text-left transition-colors hover:border-stone-400 hover:bg-stone-50 focus-visible:border-stone-500 focus-visible:ring-[3px] focus-visible:ring-stone-900/10 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            <strong class="block text-[13px] font-semibold text-stone-900">{template.label}</strong>
            <span class="mt-0.5 block text-xs text-stone-600">{template.description}</span>
            <span class="mt-2 inline-flex whitespace-nowrap rounded-full bg-stone-900 px-2 py-0.5 text-[10px] font-medium text-white">
              Recommended
            </span>
          </button>
        )}
      </For>
    </div>
  );

  const platformPills = () => (
    <div
      class="flex shrink-0 items-center gap-0.5 rounded-full border border-stone-200 bg-stone-100/80 p-0.5"
      role="group"
      aria-label="Platform"
    >
      <For each={platforms()}>
        {(item) => (
          <button
            type="button"
            aria-pressed={platform() === item.id ? "true" : "false"}
            title={
              selections().length > 0 && platform() !== item.id
                ? `Switching platforms discards the ${selections().length} collection${selections().length === 1 ? "" : "s"} in this draft`
                : undefined
            }
            onClick={() => choosePlatform(item.id)}
            class={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-stone-900/15 focus-visible:outline-none",
              platform() === item.id
                ? "bg-stone-900 text-white shadow-sm"
                : "text-stone-600 hover:bg-white hover:text-stone-900",
            )}
          >
            {item.short}
          </button>
        )}
      </For>
    </div>
  );

  const issuesButton = (compact = false) => (
    <Show when={issues().length > 0}>
      <button
        type="button"
        onClick={() => setIssuesOpen(true)}
        class={cn(
          "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors focus-visible:ring-[3px] focus-visible:outline-none",
          errorCount() > 0
            ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100 focus-visible:ring-red-500/20"
            : "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 focus-visible:ring-amber-500/20",
          compact && "border-0 bg-transparent px-0 py-0",
        )}
      >
        <Show when={errorCount() > 0} fallback={<TriangleAlert class="size-3.5" />}>
          <CircleAlert class="size-3.5" />
        </Show>
        {issues().length} issue{issues().length === 1 ? "" : "s"}
      </button>
    </Show>
  );

  const summaryPanel = () => (
    <div class="flex min-h-0 flex-1 flex-col">
      <div class="shrink-0 border-b border-stone-200 px-4 py-3">
        <h2 class="text-[13px] font-semibold text-stone-900">Summary</h2>
        <p class="mt-0.5 text-[11px] text-stone-600">
          {platformName()} · {selections().length} collection{selections().length === 1 ? "" : "s"}
        </p>
      </div>
      <div class="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <div class="space-y-1.5">
          <p class="text-[11px] font-medium text-stone-600">
            {props.mode === "dashboard" ? "Profile name" : "Policy name"}
          </p>
          <Input
            value={name()}
            onInput={(event) => setName(event.currentTarget.value)}
            placeholder={props.mode === "dashboard" ? "Profile name" : "Policy name"}
            aria-label={props.mode === "dashboard" ? "Profile name" : "Policy name"}
            class="h-8 text-[13px]"
          />
          <p class="text-[11px] leading-relaxed text-stone-600">
            {props.mode === "dashboard"
              ? "Shown on devices. The Mattrax policy name stays the same."
              : "Shown on devices and in the exported artifact."}
          </p>
        </div>

        <dl class="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-stone-200 bg-stone-200">
          <div class="bg-white px-2 py-2">
            <dt class="text-[10px] font-medium uppercase tracking-wide text-stone-500">Sets</dt>
            <dd class="mt-0.5 text-sm font-semibold tabular-nums text-stone-900">
              {selections().length}
            </dd>
          </div>
          <div class="bg-white px-2 py-2">
            <dt class="text-[10px] font-medium uppercase tracking-wide text-stone-500">
              Configured
            </dt>
            <dd class="mt-0.5 text-sm font-semibold tabular-nums text-stone-900">
              {policyStats().configured}
            </dd>
          </div>
          <div class="bg-white px-2 py-2">
            <dt class="text-[10px] font-medium uppercase tracking-wide text-stone-500">Changed</dt>
            <dd class="mt-0.5 text-sm font-semibold tabular-nums text-stone-900">
              {policyStats().changed}
            </dd>
          </div>
        </dl>

        <div class="space-y-2">
          <div class="flex items-center justify-between gap-2">
            <h3 class="text-[11px] font-semibold uppercase tracking-wide text-stone-500">Issues</h3>
            <Show when={issues().length > 0}>
              <span class="text-[10px] text-stone-600">
                {errorCount()} error{errorCount() === 1 ? "" : "s"} · {warningCount()} warning
                {warningCount() === 1 ? "" : "s"}
              </span>
            </Show>
          </div>
          <Show
            when={issues().length > 0}
            fallback={
              <p class="rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-2 text-[11px] text-stone-600">
                No validation issues. Defaults are not counted as changes.
              </p>
            }
          >
            <ul class="space-y-1">
              <For each={issues().slice(0, 40)}>
                {(issue) => (
                  <li>
                    <button
                      type="button"
                      onClick={() => focusIssue(issue)}
                      class={cn(
                        "flex w-full items-start gap-2 rounded-lg border px-2 py-1.5 text-left text-[11px] transition-colors focus-visible:ring-[3px] focus-visible:outline-none",
                        issue.severity === "error"
                          ? "border-red-200 bg-red-50/60 text-red-800 hover:bg-red-50 focus-visible:ring-red-500/20"
                          : "border-amber-200 bg-amber-50/60 text-amber-900 hover:bg-amber-50 focus-visible:ring-amber-500/20",
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
                    </button>
                  </li>
                )}
              </For>
            </ul>
            <Show when={issues().length > 40}>
              <p class="text-[10px] text-stone-600">And {issues().length - 40} more…</p>
            </Show>
          </Show>
        </div>

        <div class="space-y-1.5">
          <h3 class="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
            Collections
          </h3>
          <Show
            when={selections().length > 0}
            fallback={
              <p class="text-[11px] text-stone-600">
                Add a collection from the catalogue or start from a baseline.
              </p>
            }
          >
            <ul class="space-y-0.5">
              <For each={selections()}>
                {(selection) => {
                  const stats = () => statsFor(selection);
                  return (
                    <li>
                      <button
                        type="button"
                        onClick={() => {
                          selectCollection(selection.collectionId);
                          setSummaryOpen(false);
                        }}
                        class={cn(
                          "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] transition-colors hover:bg-stone-100 focus-visible:ring-[3px] focus-visible:outline-none",
                          activeKey() === selection.collectionId && "bg-stone-100",
                        )}
                      >
                        <span class="min-w-0 flex-1 truncate text-stone-800">{selection.name}</span>
                        <span class="shrink-0 tabular-nums text-stone-600">
                          {stats().changed}/{stats().total}
                        </span>
                      </button>
                    </li>
                  );
                }}
              </For>
            </ul>
          </Show>
        </div>

        <div class="space-y-2 rounded-lg border border-stone-200 bg-stone-50 p-2.5">
          <p class="text-[11px] leading-relaxed text-stone-600">
            {props.mode === "dashboard"
              ? "Saving replaces this policy's designer configuration. Advanced-editor settings need explicit confirmation."
              : "Export the artifact now, or deploy it into a Mattrax workspace."}
          </p>
          <button
            type="button"
            onClick={() => setStartOverOpen(true)}
            disabled={selections().length === 0}
            class="text-[11px] font-medium text-red-700 underline underline-offset-2 hover:text-red-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Start over
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div class="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-stone-50">
      <a
        href="#designer-editor"
        class="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:shadow"
      >
        Skip to settings
      </a>

      <header class="sticky top-0 z-30 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-stone-200 bg-white/85 px-3 py-2 backdrop-blur sm:px-4">
        <div class="flex min-w-0 items-center gap-2">
          <span class="hidden rounded-lg bg-stone-900 p-1.5 text-white sm:inline-flex">
            <ShieldCheck class="size-4" />
          </span>
          <div class="min-w-0">
            <h2 class="truncate text-[15px] font-semibold tracking-tight text-stone-900">
              {name() || "Untitled policy"}
            </h2>
            <p class="truncate text-[11px] text-stone-600">
              {platformName()} · {manifest()?.stats[platform()]?.properties.toLocaleString() ?? "…"}{" "}
              settings ·{" "}
              <span
                class={cn(props.mode === "dashboard" && dirtySincePolicy() && "text-amber-700")}
              >
                {saveStatus()}
              </span>
            </p>
          </div>
        </div>

        {platformPills()}

        <div class="ml-auto flex flex-wrap items-center justify-end gap-1.5">
          {props.pageActions}
          <span class="hidden xl:inline-flex">{issuesButton()}</span>
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
              onClick={() => setPreviewOpen(true)}
              disabled={selections().length === 0}
            >
              Preview
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={download}
              disabled={selections().length === 0 || blockingIssues().length > 0}
              title={
                blockingIssues().length > 0
                  ? `Fix ${blockingIssues().length} validation error${blockingIssues().length === 1 ? "" : "s"} before exporting`
                  : selections().length === 0
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
                  disabled={selections().length === 0 || blockingIssues().length > 0}
                  title={
                    blockingIssues().length > 0
                      ? `Fix ${blockingIssues().length} validation error${blockingIssues().length === 1 ? "" : "s"} before deploying`
                      : undefined
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

        <Show when={disabledHint()}>
          {(hint) => (
            <p class="order-last w-full text-right text-[11px] text-stone-600">{hint()}</p>
          )}
        </Show>
        <Show when={props.error}>
          {(error) => (
            <div
              ref={(element) => {
                errorRef = element;
              }}
              role="alert"
              class="order-last flex w-full items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700"
            >
              <CircleAlert class="size-3.5 shrink-0" />
              <span class="min-w-0 flex-1 break-words">{errorMessage(error())}</span>
            </div>
          )}
        </Show>
        <Show when={notice()}>
          {(message) => (
            <p
              role="status"
              class="order-last flex w-full items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1.5 text-[11px] text-stone-700"
            >
              <Info class="size-3.5 shrink-0" />
              <span class="min-w-0 flex-1">{message()}</span>
              <button
                type="button"
                aria-label="Dismiss message"
                class="rounded p-0.5 text-stone-500 hover:bg-stone-200 hover:text-stone-800 focus-visible:ring-2 focus-visible:outline-none"
                onClick={() => setNotice(null)}
              >
                <X class="size-3" />
              </button>
            </p>
          )}
        </Show>
      </header>

      <Show when={props.mode !== "dashboard"}>
        <div class="shrink-0 border-b border-stone-200 bg-white px-4 py-2.5 sm:px-6">
          <h1 class="text-[17px] font-semibold tracking-tight text-stone-900">
            Build a policy in minutes
          </h1>
          <p class="mt-0.5 text-xs text-stone-600">
            Browse Apple, Windows and Android settings and export a ready-to-use artifact. No
            account is needed to export; sign in only to deploy.
          </p>
        </div>
      </Show>

      <div class="flex min-h-0 flex-1">
        <aside
          class={cn(
            "min-h-0 w-full shrink-0 flex-col border-r border-stone-200 bg-white xl:flex xl:w-[288px]",
            mobileView() === "editor" ? "hidden xl:flex" : "flex",
          )}
          aria-label="Settings catalogue"
        >
          <div class="shrink-0 border-b border-stone-200 p-2.5">
            <div class="relative">
              <Search class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-stone-500" />
              <Input
                value={query()}
                onInput={(event) => setQuery(event.currentTarget.value)}
                placeholder="Search settings…"
                aria-label="Search settings"
                class="h-8 pl-8! pr-8! text-[13px]"
              />
              <Show when={query()}>
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setQuery("")}
                  class="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-stone-500 hover:bg-stone-100 hover:text-stone-900 focus-visible:ring-2 focus-visible:outline-none"
                >
                  <X class="size-3.5" />
                </button>
              </Show>
            </div>
            <div class="mt-1.5 flex items-center justify-between gap-2">
              <p class="text-[11px] text-stone-600" aria-live="polite">
                {!data()
                  ? loadingLabel()
                  : searchIndexLoading()
                    ? "Searching settings…"
                    : resultLabel()}
              </p>
              <Show when={searchIndexErrors()[platform()]}>
                <button
                  type="button"
                  onClick={retryCatalogue}
                  class="shrink-0 text-[10px] text-red-700 underline underline-offset-2"
                >
                  Search unavailable · Retry
                </button>
              </Show>
              <Show when={deprecatedCount() > 0}>
                <label class="flex shrink-0 cursor-pointer items-center gap-1 text-[11px] text-stone-600">
                  <input
                    type="checkbox"
                    class="size-3 accent-stone-900"
                    checked={showDeprecated()}
                    onChange={(event) => setShowDeprecated(event.currentTarget.checked)}
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
                  <p role="alert" class="text-xs text-red-700">
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
                fallback={<p class="p-3 text-xs text-stone-600">{loadingLabel()}</p>}
              >
                <section class="border-b border-stone-200">
                  <div class="flex items-center justify-between gap-2 px-3 pb-1 pt-2.5">
                    <h3 class="text-[11px] font-semibold uppercase tracking-wide text-stone-600">
                      In this policy ({selections().length})
                    </h3>
                    <Show when={selections().length > 0}>
                      <button
                        type="button"
                        onClick={() => setStartOverOpen(true)}
                        class="text-[10px] text-stone-500 underline underline-offset-2 hover:text-stone-900"
                      >
                        Clear
                      </button>
                    </Show>
                  </div>
                  <Show
                    when={inPolicy().length > 0}
                    fallback={
                      <p class="px-3 pb-2.5 text-[11px] leading-relaxed text-stone-600">
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
                                  ? "border-indigo-600 bg-stone-100"
                                  : "border-transparent hover:bg-stone-50",
                              )}
                            >
                              <button
                                type="button"
                                onClick={() => selectCollection(item.selection.collectionId)}
                                class="min-w-0 flex-1 py-1.5 pl-2.5 text-left focus-visible:ring-2 focus-visible:outline-none"
                              >
                                <span class="flex items-center gap-1.5">
                                  <Show when={collectionIssues().length > 0}>
                                    <span
                                      class={cn(
                                        "size-1.5 shrink-0 rounded-full",
                                        collectionIssues().some(
                                          (issue) => issue.severity === "error",
                                        )
                                          ? "bg-red-500"
                                          : "bg-amber-500",
                                      )}
                                      title={`${collectionIssues().length} validation issue${collectionIssues().length === 1 ? "" : "s"}`}
                                    />
                                  </Show>
                                  <span class="truncate text-[13px] font-medium text-stone-900">
                                    {item.selection.name}
                                  </span>
                                </span>
                                <span class="mt-0.5 block text-[11px] text-stone-600">
                                  {item.stats.changed}/{item.stats.total} settings
                                  <Show when={item.matchCount > 0}>
                                    {" "}
                                    · {item.matchCount} matching
                                  </Show>
                                </span>
                              </button>
                              <button
                                type="button"
                                aria-label={`Remove ${item.selection.name}`}
                                onClick={() => setRemoveTarget(item.selection)}
                                class="rounded p-1 text-stone-500 opacity-60 hover:bg-stone-200 hover:text-stone-900 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:outline-none group-hover:opacity-100"
                              >
                                <X class="size-3.5" />
                              </button>
                            </li>
                          );
                        }}
                      </For>
                    </ul>
                  </Show>
                </section>

                <section>
                  <div class="flex items-center justify-between px-3 pb-1 pt-2.5">
                    <h3 class="text-[11px] font-semibold uppercase tracking-wide text-stone-600">
                      Browse
                    </h3>
                    <Show when={manifestError()}>
                      <button
                        type="button"
                        onClick={retryCatalogue}
                        class="text-[10px] text-red-700 underline underline-offset-2"
                      >
                        Retry
                      </button>
                    </Show>
                  </div>
                  <Show
                    when={browseItems().length > 0}
                    fallback={
                      <p class="px-3 pb-3 text-[11px] text-stone-600">
                        {searchIndexLoading()
                          ? "Searching settings…"
                          : "No settings match that search."}
                      </p>
                    }
                  >
                    <For each={renderedGroups()}>
                      {(group) => (
                        <div>
                          <div class="sticky top-0 z-10 flex items-center gap-1 bg-stone-50/95 px-2 py-1 backdrop-blur">
                            <button
                              type="button"
                              aria-expanded={group.collapsed ? "false" : "true"}
                              onClick={() => toggleGroup(group.label)}
                              class="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-stone-100 focus-visible:ring-2 focus-visible:outline-none"
                            >
                              <ChevronDown
                                class={cn(
                                  "size-3 shrink-0 text-stone-500 transition-transform",
                                  group.collapsed && "-rotate-90",
                                )}
                              />
                              <span class="truncate text-[10px] font-semibold uppercase tracking-wide text-stone-600">
                                {group.label}
                              </span>
                              <span class="shrink-0 text-[10px] tabular-nums text-stone-500">
                                {group.total}
                              </span>
                            </button>
                          </div>
                          <ul>
                            <For each={group.items}>
                              {(item) => (
                                <li>
                                  <button
                                    type="button"
                                    onClick={() => selectCollection(keyOf(item.collection))}
                                    class={cn(
                                      "flex w-full items-start gap-2 border-l-2 py-1.5 pl-2.5 pr-2 text-left focus-visible:ring-2 focus-visible:outline-none",
                                      activeKey() === keyOf(item.collection)
                                        ? "border-indigo-600 bg-stone-100"
                                        : "border-transparent hover:bg-stone-50",
                                    )}
                                  >
                                    <span class="min-w-0 flex-1">
                                      <span class="block truncate text-[13px] text-stone-900">
                                        {item.collection.name}
                                      </span>
                                      <span class="mt-0.5 flex items-center gap-1.5 text-[11px] text-stone-600">
                                        <span class="truncate font-mono">
                                          {item.collection.group ?? item.collection.identifier}
                                        </span>
                                        <Show when={item.collection.deprecated}>
                                          <Badge
                                            variant="outline"
                                            class="h-4 border-amber-300 bg-amber-50 px-1 text-[9px] text-amber-800"
                                          >
                                            Deprecated
                                          </Badge>
                                        </Show>
                                      </span>
                                      <Show when={item.matchCount > 0}>
                                        <span class="mt-0.5 block text-[10px] text-indigo-700">
                                          {item.matchCount} matching setting
                                          {item.matchCount === 1 ? "" : "s"}
                                        </span>
                                      </Show>
                                    </span>
                                    <Show when={selected().has(keyOf(item.collection))}>
                                      <Check class="mt-0.5 size-3.5 shrink-0 text-indigo-600" />
                                    </Show>
                                  </button>
                                </li>
                              )}
                            </For>
                          </ul>
                        </div>
                      )}
                    </For>
                    <div class="border-t border-stone-200 p-2.5">
                      <Show
                        when={shownBrowseCount() < expandedBrowseTotal()}
                        fallback={
                          <p class="text-[10px] text-stone-600">
                            {expandedBrowseTotal()} collection
                            {expandedBrowseTotal() === 1 ? "" : "s"}
                          </p>
                        }
                      >
                        <p class="text-[10px] text-stone-600" aria-live="polite">
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
            "min-h-0 min-w-0 flex-1 flex-col bg-white xl:flex",
            mobileView() === "browse" ? "hidden xl:flex" : "flex",
          )}
          aria-label="Collection editor"
        >
          <Show
            when={activeSummary()}
            fallback={
              <div class="mx-auto w-full max-w-xl px-5 py-8">
                <h2 class="text-base font-semibold tracking-tight text-stone-900">
                  Start a policy
                </h2>
                <p class="mt-1 text-[13px] text-stone-600">
                  The fastest way to see a real policy. Add a baseline, then tune individual
                  settings.
                </p>
                <div class="mt-3">{templateButtons()}</div>
                <div class="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-stone-300 px-4 py-3 text-[13px] text-stone-600">
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
                    <p role="alert" class="mt-3 text-xs text-red-700">
                      {error()}{" "}
                      <button
                        type="button"
                        class="underline underline-offset-2"
                        onClick={retryCatalogue}
                      >
                        Retry
                      </button>
                    </p>
                  )}
                </Show>
              </div>
            }
          >
            {(collection) => (
              <>
                <div class="shrink-0 border-b border-stone-200 bg-white/90 px-3 py-2.5 backdrop-blur sm:px-5">
                  <div class="flex items-start gap-2">
                    <button
                      type="button"
                      onClick={() => setMobileView("browse")}
                      aria-label="Back to settings list"
                      class="-ml-1 mt-0.5 rounded-lg p-1 text-stone-600 hover:bg-stone-100 hover:text-stone-900 focus-visible:ring-2 focus-visible:outline-none xl:hidden"
                    >
                      <ArrowLeft class="size-4" />
                    </button>
                    <div class="min-w-0 flex-1">
                      <div class="flex flex-wrap items-center gap-2">
                        <h2
                          id="designer-editor-heading"
                          tabindex="-1"
                          class="truncate text-[15px] font-semibold tracking-tight text-stone-900 focus:outline-none"
                        >
                          {collection().name}
                        </h2>
                        <Show when={collection().deprecated}>
                          <Badge
                            variant="outline"
                            class="border-amber-300 bg-amber-50 text-[10px] text-amber-800"
                          >
                            Deprecated
                          </Badge>
                        </Show>
                        <Show when={activeSelection()}>
                          <Badge
                            variant="secondary"
                            class="bg-stone-100 text-[10px] text-stone-700"
                          >
                            In policy
                          </Badge>
                        </Show>
                      </div>
                      <p class="mt-0.5 truncate font-mono text-[11px] text-stone-600">
                        {collection().identifier}
                        <Show when={collection().minOs}> · {collection().minOs}+</Show>
                        <Show when={activeCollectionLoading()}>
                          <span class="text-stone-500"> · Loading settings…</span>
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
                        <p class="text-[11px] text-stone-600">
                          <span class="font-medium text-stone-800">
                            {activeStats().changed}/{activeStats().total}
                          </span>{" "}
                          changed · {activeStats().configured} configured
                        </p>
                        <Show when={activeMatchKeys()}>
                          {(keys) => (
                            <span class="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] text-indigo-700">
                              {keys().size} matching setting{keys().size === 1 ? "" : "s"}
                            </span>
                          )}
                        </Show>
                        <div class="relative ml-auto min-w-[9rem] flex-1 sm:max-w-[15rem]">
                          <Input
                            value={filterQuery()}
                            onInput={(event) => setFilterQuery(event.currentTarget.value)}
                            placeholder={`Filter ${settingCount(selection())} ${
                              settingCount(selection()) === 1 ? "setting" : "settings"
                            }`}
                            aria-label="Filter settings in this collection"
                            class="h-7 text-xs"
                          />
                        </div>
                        <div
                          class="flex shrink-0 rounded-lg border border-stone-200 bg-stone-100/70 p-0.5"
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
                              <button
                                type="button"
                                aria-pressed={filterMode() === mode.id ? "true" : "false"}
                                onClick={() => setFilterMode(mode.id)}
                                class={cn(
                                  "rounded-md px-1.5 py-0.5 text-[10px] font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
                                  filterMode() === mode.id
                                    ? "bg-white text-stone-900 shadow-sm"
                                    : "text-stone-600 hover:text-stone-900",
                                )}
                              >
                                {mode.label}
                              </button>
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
                        <p class="text-[13px] leading-relaxed text-stone-600">
                          {activeCollection()?.description ||
                            (activeCollectionLoading()
                              ? "Loading this collection from the catalogue…"
                              : "This collection is not part of your policy yet.")}
                        </p>
                        <Show when={activeCollectionError()}>
                          {(error) => (
                            <p role="alert" class="mt-2 text-xs text-red-700">
                              {error()}{" "}
                              <button
                                type="button"
                                class="underline underline-offset-2"
                                onClick={() => ensureCollection(collectionIdOf(activeKey() ?? ""))}
                              >
                                Retry
                              </button>
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
                              <p class="mt-3 rounded-lg border border-dashed border-stone-300 px-3 py-2.5 text-[12px] text-stone-600">
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
                              <div class="flex flex-wrap items-center gap-2 border-b border-indigo-100 bg-indigo-50/60 px-4 py-2 text-[11px] text-indigo-800 sm:px-5">
                                <Info class="size-3.5 shrink-0" />
                                Showing {keys().size} setting
                                {keys().size === 1 ? "" : "s"} matching “{query().trim()}”.
                                <button
                                  type="button"
                                  onClick={() => setQuery("")}
                                  class="font-medium underline underline-offset-2"
                                >
                                  Clear search
                                </button>
                              </div>
                            )}
                          </Show>
                          <Show
                            when={sections().length > 0}
                            fallback={
                              <div class="px-5 py-8 text-center">
                                <p class="text-[13px] text-stone-600">
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
                                    <div class="sticky top-0 z-10 flex items-center gap-2 border-y border-stone-200 bg-stone-50/95 px-3 py-1.5 backdrop-blur sm:px-5">
                                      <button
                                        type="button"
                                        aria-expanded={collapsed() ? "false" : "true"}
                                        onClick={() => toggleSection(sectionKey())}
                                        class="flex min-w-0 flex-1 items-center gap-2 rounded text-left focus-visible:ring-2 focus-visible:outline-none"
                                      >
                                        <ChevronDown
                                          class={cn(
                                            "size-3.5 shrink-0 text-stone-500 transition-transform",
                                            collapsed() && "-rotate-90",
                                          )}
                                        />
                                        <span class="truncate text-[11px] font-semibold uppercase tracking-wide text-stone-700">
                                          {section.label}
                                        </span>
                                        <span class="shrink-0 text-[10px] tabular-nums text-stone-500">
                                          {section.changed}/{section.properties.length}
                                        </span>
                                      </button>
                                      <Show when={section.changed > 0}>
                                        <button
                                          type="button"
                                          aria-label={`Reset ${section.label} section`}
                                          onClick={() =>
                                            resetSection(
                                              selection(),
                                              section.properties,
                                              section.label,
                                            )
                                          }
                                          class="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-stone-600 underline underline-offset-2 hover:text-stone-900 focus-visible:ring-2 focus-visible:outline-none"
                                        >
                                          Reset section
                                        </button>
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
                              <p class="border-t border-stone-100 px-4 py-3 text-[11px] text-stone-600 sm:px-5">
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
          class="hidden min-h-0 w-[312px] shrink-0 flex-col border-l border-stone-200 bg-white xl:flex"
          aria-label="Policy summary"
        >
          {summaryPanel()}
        </aside>
      </div>

      <div class="fixed inset-x-0 bottom-0 z-40 flex items-center gap-2 border-t border-stone-200 bg-white/95 px-3 py-2 backdrop-blur xl:hidden">
        <div class="min-w-0 flex-1 text-[11px] text-stone-600">
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
          disabled={selections().length === 0 || blockingIssues().length > 0}
        >
          Export
        </Button>
        <Show
          when={props.onSave}
          fallback={
            <Button
              size="sm"
              onClick={deploy}
              disabled={selections().length === 0 || blockingIssues().length > 0}
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
      <div class="h-[57px] shrink-0 xl:hidden" aria-hidden="true" />

      <p role="status" aria-live="polite" class="sr-only">
        {liveMessage()}
      </p>

      {/* Destructive platform switch */}
      <Dialog
        open={pendingPlatform() !== null}
        onOpenChange={(open) => {
          if (!open) setPendingPlatform(null);
        }}
      >
        <DialogContent class="max-w-md rounded-xl bg-white p-5">
          <DialogHeader>
            <DialogTitle class="text-base">
              Switch to {platformLabel(pendingPlatform())}?
            </DialogTitle>
            <DialogDescription class="mt-1 text-[13px] leading-relaxed text-stone-600">
              This draft has {selections().length} {platformName()} collection
              {selections().length === 1 ? "" : "s"}. Switching platforms replaces the draft with a
              new {platformLabel(pendingPlatform())} draft; the current selections will be
              discarded.
              {props.mode === "dashboard"
                ? " Saved policy settings are not deleted until you save."
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter class="mt-4 flex-row justify-end gap-2 bg-transparent p-0">
            <Button variant="outline" onClick={() => setPendingPlatform(null)}>
              Keep {platformName()}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const next = pendingPlatform();
                if (next) applyPlatform(next, true);
              }}
            >
              Switch and discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove a collection */}
      <Dialog
        open={removeTarget() !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
      >
        <DialogContent class="max-w-md rounded-xl bg-white p-5">
          <DialogHeader>
            <DialogTitle class="text-base">Remove {removeTarget()?.name}?</DialogTitle>
            <DialogDescription class="mt-1 text-[13px] leading-relaxed text-stone-600">
              {removeTarget()
                ? `This collection and its ${statsFor(removeTarget()!).configured} configured setting${
                    statsFor(removeTarget()!).configured === 1 ? "" : "s"
                  } will be removed from this policy. Export first if you need a copy.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter class="mt-4 flex-row justify-end gap-2 bg-transparent p-0">
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
        <DialogContent class="max-w-md rounded-xl bg-white p-5">
          <DialogHeader>
            <DialogTitle class="text-base">Start over?</DialogTitle>
            <DialogDescription class="mt-1 text-[13px] leading-relaxed text-stone-600">
              This clears every collection and setting in the current {platformName()} draft.
              {props.mode === "dashboard"
                ? " Settings already saved to the policy are not changed until you save."
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter class="mt-4 flex-row justify-end gap-2 bg-transparent p-0">
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
        <DialogContent class="max-h-[80vh] max-w-2xl overflow-hidden rounded-xl bg-white p-5">
          <DialogHeader>
            <DialogTitle class="text-base">Review issues</DialogTitle>
            <DialogDescription class="mt-1 text-[13px] text-stone-600">
              {errorCount()} error{errorCount() === 1 ? "" : "s"} block saving and exporting.{" "}
              {warningCount()} warning{warningCount() === 1 ? "" : "s"} should be reviewed.
            </DialogDescription>
          </DialogHeader>
          <ul class="mt-3 max-h-[52vh] space-y-1 overflow-y-auto">
            <For each={issues()}>
              {(issue) => (
                <li>
                  <button
                    type="button"
                    onClick={() => focusIssue(issue)}
                    class={cn(
                      "flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-[13px] transition-colors focus-visible:ring-[3px] focus-visible:outline-none",
                      issue.severity === "error"
                        ? "border-red-200 bg-red-50/60 text-red-800 hover:bg-red-50"
                        : "border-amber-200 bg-amber-50/60 text-amber-900 hover:bg-amber-50",
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
                      <span class="block text-[12px] opacity-80">
                        {issue.collectionName} · {issue.message}
                      </span>
                    </span>
                  </button>
                </li>
              )}
            </For>
          </ul>
          <DialogFooter class="mt-4 flex-row justify-end bg-transparent p-0">
            <Button variant="outline" onClick={() => setIssuesOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Artifact preview */}
      <Dialog open={previewOpen()} onOpenChange={setPreviewOpen}>
        <DialogContent class="max-h-[85vh] max-w-3xl overflow-hidden rounded-xl bg-white p-5">
          <DialogHeader>
            <DialogTitle class="text-base">Artifact preview</DialogTitle>
            <DialogDescription class="mt-1 text-[13px] text-stone-600">
              {(() => {
                try {
                  const artifact = buildArtifact(draft());
                  return `${artifact.fileName} · ${artifact.contentType}`;
                } catch {
                  return "The artifact cannot be generated yet.";
                }
              })()}
            </DialogDescription>
          </DialogHeader>
          <pre class="mt-3 max-h-[60vh] overflow-auto rounded-lg border border-stone-200 bg-stone-50 p-3 font-mono text-[11px] leading-relaxed text-stone-800">
            {(() => {
              try {
                return buildArtifact(draft()).content;
              } catch (error) {
                return errorMessage(error);
              }
            })()}
          </pre>
          <DialogFooter class="mt-3 flex-row justify-end bg-transparent p-0">
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Summary sheet below xl */}
      <Sheet open={summaryOpen()} onOpenChange={setSummaryOpen}>
        <Show when={summaryOpen()}>
          <SheetContent side="right" class="w-[min(92vw,360px)] bg-white p-0">
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
      <span class="text-[10px] text-stone-500">No issues</span>
    </Show>
  );
}

type PropertyFieldProps = {
  property: Property;
  platform: PlatformId;
  value: unknown;
  id: string;
  changed: boolean;
  searchMatch: boolean;
  issue?: ValidationIssue;
  onChange: (value: unknown) => void;
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

  const arrayValue = () => (Array.isArray(props.value) ? (props.value as unknown[]) : []);
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
        "designer-field relative flex flex-col gap-2 border-b border-stone-100 px-4 py-3 last:border-b-0",
        rowInvalid() && "bg-red-50/40",
      )}
    >
      <Show when={props.changed}>
        <span class="absolute inset-y-0 left-0 w-0.5 bg-indigo-600" aria-hidden="true" />
      </Show>
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Show
            when={groupedControl()}
            fallback={
              <label for={props.id} class="text-[13px] font-medium text-stone-900">
                {props.property.name}
              </label>
            }
          >
            <span class="text-[13px] font-medium text-stone-900">{props.property.name}</span>
          </Show>
          <Show when={props.property.required}>
            <span class="text-[10px] font-medium uppercase tracking-wide text-red-700">
              Required
            </span>
          </Show>
          <Show when={props.changed}>
            <Badge variant="secondary" class="h-4 bg-indigo-50 px-1 text-[9px] text-indigo-700">
              Changed
            </Badge>
          </Show>
          <Show when={props.property.deprecated}>
            <Badge
              variant="outline"
              class="h-4 border-amber-300 bg-amber-50 px-1 text-[9px] text-amber-800"
            >
              Deprecated
            </Badge>
          </Show>
          <button
            type="button"
            onClick={() => setShowDescription((value) => !value)}
            aria-expanded={showDescription() ? "true" : "false"}
            aria-controls={descId()}
            aria-label={`${showDescription() ? "Hide" : "Show"} description for ${props.property.name}`}
            class="rounded p-0.5 text-stone-500 hover:bg-stone-100 hover:text-stone-900 focus-visible:ring-2 focus-visible:outline-none"
          >
            <Info class="size-3.5" />
          </button>
          <Show when={props.changed}>
            <button
              type="button"
              onClick={props.onReset}
              aria-label={`Reset ${props.property.name} to its default`}
              class="ml-auto inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] text-stone-600 underline underline-offset-2 hover:text-stone-900 focus-visible:ring-2 focus-visible:outline-none"
            >
              <RotateCcw class="size-3" /> Reset
            </button>
          </Show>
        </div>
        <p
          id={descId()}
          class={cn(
            "mt-1 text-xs leading-relaxed text-stone-600",
            !descriptionVisible() && "sr-only",
          )}
        >
          {props.property.description || "No description in the catalogue."}
        </p>
        <div
          id={hintId()}
          class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-stone-600"
        >
          <span class="max-w-full truncate font-mono text-[10px] text-stone-500">
            {props.property.address ?? props.property.key}
          </span>
          <span aria-hidden="true">·</span>
          <span>{typeLabel(props.property.type)}</span>
          <Show when={catalogDefault(props.property) !== undefined}>
            <span>
              Default:{" "}
              <span class="text-stone-700">{formatValue(catalogDefault(props.property))}</span>
            </span>
          </Show>
          <Show when={props.property.min !== undefined || props.property.max !== undefined}>
            <span>
              Min {props.property.min ?? "—"} · Max {props.property.max ?? "—"}
            </span>
          </Show>
          <Show when={props.property.pattern}>
            {(pattern) => (
              <span class="max-w-full truncate font-mono text-[10px]">Pattern: {pattern()}</span>
            )}
          </Show>
          <Show when={props.searchMatch}>
            <span class="text-indigo-700">Matches search</span>
          </Show>
        </div>
        <Show when={props.issue}>
          {(issue) => (
            <p
              id={errorId()}
              class={cn(
                "mt-1 text-[11px]",
                issue().severity === "error" ? "text-red-700" : "text-amber-800",
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
              class="h-8 w-full rounded-lg border border-stone-300 bg-white px-2 text-[13px] text-stone-900 outline-none transition-colors focus-visible:border-stone-500 focus-visible:ring-[3px] focus-visible:ring-stone-900/10 aria-invalid:border-red-400"
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
                  class="h-7 text-xs"
                />
              </Show>
              <div class="flex items-center justify-between gap-2 text-[10px] text-stone-600">
                <span>{arrayValue().length} selected</span>
                <span class="flex gap-2">
                  <button
                    type="button"
                    onClick={selectAllOptions}
                    class="underline underline-offset-2 hover:text-stone-900"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={() => props.onChange([])}
                    class="underline underline-offset-2 hover:text-stone-900"
                  >
                    None
                  </button>
                </span>
              </div>
              <div
                id={props.id}
                role="group"
                aria-label={props.property.name}
                aria-required={props.property.required ? "true" : undefined}
                aria-invalid={invalid() ? "true" : undefined}
                aria-describedby={describedBy()}
                class={cn(
                  "max-h-52 space-y-0.5 overflow-y-auto rounded-lg border bg-white p-1.5",
                  invalid() ? "border-red-400" : "border-stone-300",
                )}
              >
                <For
                  each={visibleOptions()}
                  fallback={<p class="px-1 py-2 text-xs text-stone-600">No options match.</p>}
                >
                  {(option) => (
                    <label class="flex items-start gap-2 rounded px-1 py-0.5 text-[12px] leading-snug text-stone-700 hover:bg-stone-50">
                      <input
                        type="checkbox"
                        class="mt-0.5 size-3.5 accent-stone-900"
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
            </div>
          )}
        </Show>

        <Show when={isBoolean()}>
          <div
            id={props.id}
            role="group"
            aria-label={props.property.name}
            aria-required={props.property.required ? "true" : undefined}
            aria-invalid={invalid() ? "true" : undefined}
            aria-describedby={describedBy()}
            class="flex w-full rounded-lg border border-stone-300 bg-white p-0.5"
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
                  <button
                    type="button"
                    aria-pressed={pressed() ? "true" : "false"}
                    onClick={() => props.onChange(option.value)}
                    class={cn(
                      "flex-1 rounded-md px-1.5 py-1 text-[11px] font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
                      pressed()
                        ? "bg-stone-900 text-white"
                        : "text-stone-600 hover:bg-stone-100 hover:text-stone-900",
                    )}
                  >
                    {option.label}
                  </button>
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
  value: unknown;
  id: string;
  describedBy: string;
  invalid: boolean;
  onInvalidChange: (invalid: boolean) => void;
  onChange: (value: unknown) => void;
}) {
  const isData = () => props.property.type === "data";
  const format = (value: unknown) => {
    if (value === undefined || value === null) return "";
    if (isData()) return typeof value === "string" ? value : String(value);
    if (typeof value === "string") return value;
    return JSON.stringify(value, null, 2);
  };
  const [text, setText] = createSignal(format(props.value));
  const [error, setError] = createSignal<string | null>(null);
  let lastIncoming: unknown;
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
      const parsed = JSON.parse(raw) as unknown;
      if (props.property.type === "array" && !Array.isArray(parsed)) {
        setError('Expected a JSON list, for example ["value"].');
        props.onInvalidChange(true);
        return;
      }
      if (
        props.property.type === "dictionary" &&
        (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      ) {
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
          "min-h-24 w-full rounded-lg border bg-white p-2 font-mono text-[11px] leading-relaxed text-stone-800 outline-none transition-colors focus-visible:ring-[3px]",
          props.invalid || error()
            ? "border-red-400 focus-visible:border-red-500 focus-visible:ring-red-500/20"
            : "border-stone-300 focus-visible:border-stone-500 focus-visible:ring-stone-900/10",
        )}
      />
      <Show when={error()}>
        {(message) => (
          <p id={`${props.id}-json-error`} class="text-[11px] text-red-700">
            {message()}
          </p>
        )}
      </Show>
      <p class="text-[10px] text-stone-600">
        {isData() ? "Base64 data — pasted text is stored as-is." : "Advanced JSON"}
      </p>
    </div>
  );
}
