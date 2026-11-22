import { createSignal } from "solid-js";
import { isServer } from "@solidjs/web";
import { Option, Schema } from "effect";

/**
 * Dashboards a person pinned to their sidebar.
 *
 * Pinning is a personal view preference, not tenant data: it lives in this
 * browser so two administrators can arrange the same fleet differently. Entries
 * are tenant-scoped, and the sidebar refreshes their names from the dashboards
 * query so a rename (or delete) is reflected without re-pinning.
 */
export type PinnedDashboard = {
  readonly tenantId: string;
  readonly dashboardId: string;
  readonly name: string;
};

const STORAGE_KEY = "mattrax:pinned-dashboards";
const CHANGE_EVENT = "mattrax:pinned-dashboards-changed";

const [pinned, setPinned] = createSignal<ReadonlyArray<PinnedDashboard>>([]);
let installed = false;

const PinnedDashboardSchema = Schema.Struct({
  tenantId: Schema.String,
  dashboardId: Schema.String,
  name: Schema.String,
});

const decodePins = Schema.decodeUnknownOption(Schema.Array(PinnedDashboardSchema));

const read = (): ReadonlyArray<PinnedDashboard> => {
  if (isServer) return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);

    return Option.getOrUndefined(decodePins(parsed)) ?? [];
  } catch {
    return [];
  }
};

const hydrate = () => setPinned(read());

const write = (entries: ReadonlyArray<PinnedDashboard>) => {
  if (isServer) return;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage can be disabled or full. Keep the in-memory result for this tab.
  }
};

const publish = (entries: ReadonlyArray<PinnedDashboard>) => {
  setPinned(entries);
  write(entries);

  if (!isServer) window.dispatchEvent(new Event(CHANGE_EVENT));
};

/** Start tracking pins for this tab. Safe to call on every render. */
export function installPinnedDashboards() {
  if (installed || isServer) return;
  installed = true;
  // The shell installs this while it renders; a signal write there trips the
  // strict reactivity diagnostic. Hydrate after the current scope settles.
  queueMicrotask(hydrate);

  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) hydrate();
  });
  window.addEventListener(CHANGE_EVENT, hydrate);
}

export const pinnedDashboardsFor = (tenantId: string | undefined): ReadonlyArray<PinnedDashboard> =>
  tenantId ? pinned().filter((entry) => entry.tenantId === tenantId) : [];

export const isDashboardPinned = (tenantId: string | undefined, dashboardId: string): boolean =>
  pinnedDashboardsFor(tenantId).some((entry) => entry.dashboardId === dashboardId);

/**
 * Remove pins whose dashboard no longer appears in the tenant's list. Deferred
 * so a page can call it from an effect without writing reactive state inside an
 * owned scope.
 */
export function prunePinnedDashboards(tenantId: string, dashboardIds: ReadonlySet<string>): void {
  queueMicrotask(() => {
    const current = pinned();
    const next = current.filter(
      (entry) => entry.tenantId !== tenantId || dashboardIds.has(entry.dashboardId),
    );

    if (next.length !== current.length) publish(next);
  });
}

/** Pin or unpin a dashboard; returns the state it was moved to. */
export function togglePinnedDashboard(entry: PinnedDashboard): boolean {
  const current = pinned();
  const exists = current.some(
    (item) => item.tenantId === entry.tenantId && item.dashboardId === entry.dashboardId,
  );

  publish(
    exists
      ? current.filter(
          (item) => item.tenantId !== entry.tenantId || item.dashboardId !== entry.dashboardId,
        )
      : [...current, entry],
  );

  return !exists;
}
