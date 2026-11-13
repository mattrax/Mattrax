import { useLocation, useNavigate, useParams } from "@solidjs/router";
import { useQuery } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, For, onCleanup, onSettled, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import {
  Boxes,
  Laptop,
  LayoutDashboard,
  LinkIcon,
  Package,
  Search,
  Settings,
  ShieldCheck,
  UsersRound,
} from "~/components/ui/icons";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";
import { cn } from "~/lib/utils";

type Item = {
  id: string;
  label: string;
  hint?: string;
  group: string;
  href: string;
  icon?: (props: { class?: string }) => JSX.Element;
};

const RECENTS_KEY = "mattrax:recents";

function readRecents(): Array<{ id: string; label: string; href: string; group: string }> {
  try {
    return JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function CommandPalette() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [debouncedQuery, setDebouncedQuery] = createSignal("");
  const [active, setActive] = createSignal(0);
  const [recents, setRecents] = createSignal(readRecents());
  const tenantId = () => params.tenantId;
  const base = () => (tenantId() ? `/t/${tenantId()}` : "");
  const SEARCH_LIMIT = 30;

  const [truncated, setTruncated] = createSignal(false);
  // Debounce in the input handler (not an effect) so the palette's global
  // shortcut setup is not delayed by derived work.
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  const updateQuery = (value: string) => {
    setQuery(value);
    setActive(0);
    setTruncated(false);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => setDebouncedQuery(value.trim()), 200);
  };
  onCleanup(() => clearTimeout(searchTimer));
  const results = useQuery(() => ({
    queryKey: enterpriseKeys.search(tenantId(), debouncedQuery(), SEARCH_LIMIT),
    queryFn: async () => {
      const result = await enterprise.search(tenantId(), {
        q: debouncedQuery(),
        limit: SEARCH_LIMIT,
      });
      setTruncated((result.rows?.length ?? 0) >= SEARCH_LIMIT);
      return result;
    },
    enabled: open() && Boolean(tenantId()) && debouncedQuery().length > 0,
  }));

  const navigation = createMemo<Item[]>(() => [
    {
      id: "nav-dashboard",
      label: "Dashboard",
      group: "Navigation",
      href: "/dashboard",
      icon: LayoutDashboard,
    },
    ...(tenantId()
      ? [
          {
            id: "nav-devices",
            label: "Devices",
            group: "Navigation",
            href: `${base()}/devices`,
            icon: Laptop,
          },
          {
            id: "nav-groups",
            label: "Groups",
            group: "Navigation",
            href: `${base()}/groups`,
            icon: UsersRound,
          },
          {
            id: "nav-policies",
            label: "Policies",
            group: "Navigation",
            href: `${base()}/policies`,
            icon: ShieldCheck,
          },
          {
            id: "nav-applications",
            label: "Applications",
            group: "Navigation",
            href: `${base()}/applications`,
            icon: Package,
          },
          {
            id: "nav-software",
            label: "Software",
            group: "Navigation",
            href: `${base()}/software`,
            icon: Boxes,
          },
          {
            id: "nav-enrollment",
            label: "Enrollment",
            group: "Navigation",
            href: `${base()}/settings/enrollment`,
            icon: LinkIcon,
          },
          {
            id: "nav-settings",
            label: "Settings",
            group: "Navigation",
            href: `${base()}/settings`,
            icon: Settings,
          },
        ]
      : []),
    { id: "nav-account", label: "Account", group: "Navigation", href: "/account", icon: Settings },
  ]);

  const serverItems = createMemo<Item[]>(() => {
    const id = tenantId();
    // Reading `.data` before the query settles is a pending async read in this
    // Solid version and would abort the palette subtree.
    if (!id || results.status !== "success") return [];
    return (results.data?.rows ?? []).map((row) => {
      if ("proto" in row)
        return {
          id: `device-${row.id}`,
          label: row.name,
          hint: [row.serial, row.model].filter(Boolean).join(" · ") || row.id,
          group: "Devices",
          href: `/t/${id}/devices/${row.id}`,
          icon: Laptop,
        };
      if ("devicesCount" in row)
        return {
          id: `group-${row.id}`,
          label: row.name,
          hint: `${row.devicesCount ?? 0} devices`,
          group: "Groups",
          href: `/t/${id}/groups/${row.id}`,
          icon: UsersRound,
        };
      return {
        id: `policy-${row.id}`,
        label: row.name,
        hint: "Policy",
        group: "Policies",
        href: `/t/${id}/policies/${row.id}`,
        icon: ShieldCheck,
      };
    });
  });

  const items = createMemo<Item[]>(() => {
    const term = query().trim().toLowerCase();
    if (!term) {
      const recentItems = recents().map((item) => ({
        ...item,
        icon: (item.group === "Devices"
          ? Laptop
          : item.group === "Groups"
            ? UsersRound
            : ShieldCheck) as Item["icon"],
      }));
      const seen = new Set(recentItems.map((item) => item.id));
      return [...recentItems, ...navigation().filter((item) => !seen.has(item.id))];
    }
    const navMatches = navigation().filter(
      (item) => item.label.toLowerCase().includes(term) || item.hint?.toLowerCase().includes(term),
    );
    return [...navMatches, ...serverItems()];
  });

  const grouped = createMemo(() => {
    const map = new Map<string, Item[]>();
    for (const item of items().slice(0, 40)) {
      const list = map.get(item.group) ?? [];
      list.push(item);
      map.set(item.group, list);
    }
    return [...map];
  });

  const remember = (item: Item) => {
    if (item.group === "Navigation") return;
    const next = [
      { id: item.id, label: item.label, href: item.href, group: item.group },
      ...recents().filter((entry) => entry.id !== item.id),
    ].slice(0, 8);
    setRecents(next);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  };

  const run = (item: Item | undefined) => {
    if (!item) return;
    remember(item);
    setOpen(false);
    setQuery("");
    setDebouncedQuery("");
    setTruncated(false);
    navigate(item.href);
  };

  createEffect(
    () => ({ path: location.pathname, open: open() }),
    ({ open }) => {
      if (!open) setActive(0);
    },
  );

  onSettled(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
      if (!open()) return;
      if (event.key === "Escape") setOpen(false);
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActive((value) => Math.min(value + 1, items().length - 1));
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActive((value) => Math.max(value - 1, 0));
      }
      if (event.key === "Enter") {
        event.preventDefault();
        run(items()[active()]);
      }
    };
    const openEvent = () => setOpen(true);
    window.addEventListener("keydown", handler);
    window.addEventListener("mattrax:open-command-palette", openEvent);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("mattrax:open-command-palette", openEvent);
    };
  });

  let input: HTMLInputElement | undefined;
  createEffect(
    () => open(),
    (isOpen) => {
      if (isOpen) queueMicrotask(() => input?.focus());
    },
  );

  return (
    <Show when={open()}>
      <div
        class="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 px-4 pt-[12vh] backdrop-blur-sm"
        onClick={() => setOpen(false)}
      >
        <div
          class="dark w-full max-w-xl overflow-hidden rounded-xl border border-white/[0.09] bg-popover shadow-2xl shadow-black/70"
          onClick={(event) => event.stopPropagation()}
        >
          <div class="flex items-center gap-2 border-b px-4 py-3">
            <Search class="size-4 text-muted-foreground" />
            <input
              ref={input}
              value={query()}
              onInput={(event) => updateQuery(event.currentTarget.value)}
              placeholder="Search devices, groups, policies, or pages…"
              class="flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-muted-foreground"
            />
            <kbd class="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">esc</kbd>
          </div>
          <div class="max-h-[55vh] overflow-auto p-2">
            <Show
              when={items().length > 0}
              fallback={
                <p class="px-3 py-6 text-center text-sm text-muted-foreground">No results.</p>
              }
            >
              <For each={grouped()}>
                {([group, groupItems]) => (
                  <div class="mb-1">
                    <p class="px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {group === "Navigation" && query().trim() === "" && recents().length > 0
                        ? "Recent"
                        : group}
                    </p>
                    <For each={groupItems}>
                      {(item) => (
                        <button
                          type="button"
                          onMouseEnter={() => setActive(items().indexOf(item))}
                          onClick={() => run(item)}
                          class={cn(
                            "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm",
                            active() === items().indexOf(item)
                              ? "bg-white/[0.07]"
                              : "hover:bg-white/[0.04]",
                          )}
                        >
                          <Show when={item.icon}>
                            {(icon) => {
                              const Icon = icon();
                              return <Icon class="size-4 shrink-0 text-muted-foreground" />;
                            }}
                          </Show>
                          <span class="min-w-0 flex-1">
                            <span class="block truncate font-medium text-foreground">
                              {item.label}
                            </span>
                            <Show when={item.hint}>
                              <span class="block truncate text-xs text-muted-foreground">
                                {item.hint}
                              </span>
                            </Show>
                          </span>
                        </button>
                      )}
                    </For>
                  </div>
                )}
              </For>
            </Show>
          </div>
          <div class="flex items-center justify-between border-t px-4 py-2 text-[11px] text-muted-foreground">
            <span>↑↓ navigate · ↵ open</span>
            <Show when={truncated()} fallback={<span>⌘K to toggle</span>}>
              <span>Showing first {SEARCH_LIMIT} matches</span>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}
