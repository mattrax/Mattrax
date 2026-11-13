import { useLocation, useNavigate, useParams } from "@solidjs/router";
import { useQuery } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, For, onCleanup, onSettled, Show } from "solid-js";
import { Button } from "~/components/ui/button";
import {
  Activity,
  BookOpen,
  Boxes,
  Laptop,
  LayoutDashboard,
  LinkIcon,
  LogOut,
  Package,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  User,
  UsersRound,
} from "~/components/ui/icons";
import { authClient } from "~/lib/auth";
import {
  chord,
  isEditableTarget,
  matchesChord,
  registeredCommands,
  sequence,
  shortcutLabel,
  type Command,
  type CommandShortcut,
} from "~/lib/commands";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";
import { errorMessage } from "~/lib/errors";
import { reportGlobalError } from "~/lib/global-errors";
import { cn } from "~/lib/utils";

const RECENTS_KEY = "mattrax:recents";
const SEARCH_LIMIT = 30;

type Recent = { id: string; title: string; hint?: string; group: string; href: string };

function readRecents(): Recent[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]") as Array<
      Recent & { label?: string }
    >;

    return parsed.map((item) => ({
      id: item.id,
      title: item.title ?? item.label ?? "",
      hint: item.hint,
      group: item.group,
      href: item.href,
    }));
  } catch {
    return [];
  }
}

const GROUP_ORDER = [
  "Recent",
  "This page",
  "Actions",
  "Navigation",
  "Settings",
  "Queries",
  "Devices",
  "People",
  "Groups",
  "Policies",
];

const groupRank = (group: string) => {
  const index = GROUP_ORDER.indexOf(group);

  return index === -1 ? GROUP_ORDER.length : index;
};

const iconForGroup = (group: string): Command["icon"] => {
  if (group === "Devices") return Laptop;

  if (group === "People") return User;

  if (group === "Groups") return UsersRound;

  if (group === "Policies") return ShieldCheck;

  if (group === "Settings") return Settings;

  if (group === "Queries") return Search;

  if (group === "Actions") return Activity;

  return LayoutDashboard;
};

export function CommandPalette() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [debouncedQuery, setDebouncedQuery] = createSignal("");
  const [active, setActive] = createSignal(0);
  let card: HTMLDivElement | undefined;
  let opener: HTMLElement | null = null;
  const [recents, setRecents] = createSignal(readRecents());
  const tenantId = () => params.tenantId;
  const base = () => (tenantId() ? `/t/${tenantId()}` : "");
  const [truncated, setTruncated] = createSignal(false);

  // Debounce search in the input handler so shortcut registration is not
  // delayed by derived work.
  let searchTimer: ReturnType<typeof setTimeout> | undefined;

  const updateQuery = (value: string) => {
    setQuery(value);
    setActive(0);
    setTruncated(false);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => setDebouncedQuery(value.trim()), 180);
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

  const navigable = (id: string, title: string, href: string, run: () => void): Command => ({
    id,
    title,
    href,
    group: "Navigation",
    icon: iconForGroup("Navigation"),
    run,
  });

  const builtIn = createMemo<Command[]>(() => {
    const id = tenantId();
    const go = (href: string) => () => navigate(href);

    const actions: Command[] = [
      {
        id: "account-settings",
        title: "Account settings",
        subtitle: "Profile, security, API tokens and sessions",
        group: "Actions",
        icon: User,
        href: "/account",
        keywords: ["profile", "security", "passkey", "mfa", "tokens", "sessions"],
        shortcut: chord(",", { mod: true }),
        run: go("/account"),
      },
      {
        id: "documentation",
        title: "Documentation",
        subtitle: "Open the Mattrax docs",
        group: "Actions",
        icon: BookOpen,
        keywords: ["docs", "help", "guide"],
        shortcut: sequence("g", "h"),
        run: () => window.location.assign("/docs/"),
      },
      {
        id: "system-status",
        title: "System status",
        group: "Actions",
        icon: Activity,
        keywords: ["status", "uptime", "incident"],
        run: () => window.open("https://status.otbeaumont.me", "_blank", "noopener"),
      },
      {
        id: "send-feedback",
        title: "Send feedback",
        group: "Actions",
        icon: BookOpen,
        keywords: ["support", "email", "contact"],
        run: () => window.location.assign("mailto:hello@mattrax.app?subject=Mattrax%20feedback"),
      },
      {
        id: "sign-out",
        title: "Sign out",
        group: "Actions",
        icon: LogOut,
        keywords: ["logout", "signout"],
        shortcut: chord("l", { mod: true, shift: true }),
        run: async () => {
          try {
            const result = await authClient.signOut();

            if (result.error) {
              reportGlobalError(result.error);

              return;
            }
          } catch (error) {
            reportGlobalError(error);

            return;
          }

          window.location.assign("/login");
        },
      },
    ];

    if (!id) return actions;

    const nav = (command: Command) => ({ ...command, href: command.href ?? undefined });

    const navigation: Command[] = [
      nav(navigable("nav-overview", "Overview", `${base()}`, go(`${base()}`))),
      nav(
        navigable(
          "nav-dashboards",
          "Dashboards",
          `${base()}/dashboards`,
          go(`${base()}/dashboards`),
        ),
      ),
      nav(navigable("nav-devices", "Devices", `${base()}/devices`, go(`${base()}/devices`))),
      nav(navigable("nav-groups", "Groups", `${base()}/groups`, go(`${base()}/groups`))),
      nav(navigable("nav-policies", "Policies", `${base()}/policies`, go(`${base()}/policies`))),
      nav(
        navigable(
          "nav-applications",
          "Applications",
          `${base()}/applications`,
          go(`${base()}/applications`),
        ),
      ),
      nav(navigable("nav-settings", "Settings", `${base()}/settings`, go(`${base()}/settings`))),
    ];

    const shortcuts: Record<string, CommandShortcut> = {
      "nav-overview": sequence("g", "o"),
      "nav-dashboards": sequence("g", "b"),
      "nav-devices": sequence("g", "d"),
      "nav-groups": sequence("g", "g"),
      "nav-policies": sequence("g", "p"),
      "nav-applications": sequence("g", "a"),
      "nav-settings": sequence("g", "t"),
    };

    const withShortcuts = navigation.map((command) =>
      shortcuts[command.id] ? { ...command, shortcut: shortcuts[command.id]! } : command,
    );

    const create: Command[] = [
      {
        id: "new-policy",
        title: "Create policy",
        group: "Actions",
        icon: Plus,
        href: `${base()}/policies/new`,
        keywords: ["new", "add", "policy"],
        shortcut: sequence("n", "p"),
        run: go(`${base()}/policies/new`),
      },
      {
        id: "new-group",
        title: "Create group",
        group: "Actions",
        icon: Plus,
        href: `${base()}/groups/new`,
        keywords: ["new", "add", "group"],
        shortcut: sequence("n", "g"),
        run: go(`${base()}/groups/new`),
      },
      {
        id: "new-dashboard",
        title: "Create dashboard",
        group: "Actions",
        icon: Plus,
        href: `${base()}/dashboards`,
        keywords: ["new", "add", "dashboard", "overview", "widget"],
        shortcut: sequence("n", "d"),
        run: go(`${base()}/dashboards`),
      },
      {
        id: "new-tenant",
        title: "Create tenant",
        group: "Actions",
        icon: Plus,
        href: "/tenants/new",
        keywords: ["new", "add", "tenant", "workspace"],
        shortcut: sequence("n", "t"),
        run: go("/tenants/new"),
      },
    ];

    const settings: Command[] = [
      ["general", "General settings", ["profile", "branding", "name", "slug"], "general"],
      [
        "members",
        "Members",
        ["people", "users", "invite", "roles", "administrators"],
        "administrators",
      ],
      [
        "identity",
        "Identity & SSO",
        ["sso", "scim", "entra", "directory", "single sign-on"],
        "identity",
      ],
      ["enrollment", "Enrollment settings", ["enroll", "onboarding", "link"], "enrollment"],
      [
        "management",
        "Device management",
        ["apns", "apple push", "scep", "android", "certificate"],
        "management",
      ],
      [
        "delivery",
        "Apple push delivery",
        ["apns", "push", "failing", "invalid token", "diagnostics"],
        "delivery",
      ],
      ["integrations", "Integrations", ["webhooks", "events", "api"], "integrations"],
      ["audit", "Audit log", ["events", "history", "export"], "audit"],
      ["billing", "Billing", ["plan", "invoice", "stripe", "usage"], "billing"],
    ].map(([key, title, keywords, path]) => ({
      id: `settings-${key}`,
      title: title as string,
      group: "Settings",
      icon: Settings,
      href: `${base()}/settings/${path === "general" ? "" : path}`.replace(/\/$/, ""),
      keywords: keywords as string[],
      run: go(`${base()}/settings/${path === "general" ? "" : path}`.replace(/\/$/, "")),
    }));

    const queries: Command[] = [
      {
        id: "query-attention",
        title: "Devices needing attention",
        group: "Queries",
        icon: Laptop,
        href: `${base()}/devices?health=attention`,
        keywords: ["unhealthy", "warning", "attention", "table", "filter"],
        run: go(`${base()}/devices?health=attention`),
      },
      {
        id: "query-critical",
        title: "Critical devices",
        group: "Queries",
        icon: Laptop,
        href: `${base()}/devices?health=critical`,
        keywords: ["unhealthy", "critical", "table", "filter"],
        run: go(`${base()}/devices?health=critical`),
      },
      {
        id: "query-stale",
        title: "Devices not seen in 7 days",
        group: "Queries",
        icon: Laptop,
        href: `${base()}/devices?health=stale`,
        keywords: ["stale", "offline", "not checking in", "table", "filter"],
        run: go(`${base()}/devices?health=stale`),
      },
      {
        id: "query-push-failing",
        title: "Apple push failures",
        group: "Queries",
        icon: Laptop,
        href: `${base()}/devices?push=failing`,
        keywords: ["apns", "push", "failing", "invalid", "table", "filter"],
        run: go(`${base()}/devices?push=failing`),
      },
      {
        id: "query-apple",
        title: "Apple devices",
        group: "Queries",
        icon: Laptop,
        href: `${base()}/devices?proto=apple`,
        keywords: ["mac", "ios", "ipados", "apple", "table", "filter"],
        run: go(`${base()}/devices?proto=apple`),
      },
      {
        id: "query-windows",
        title: "Windows devices",
        group: "Queries",
        icon: Laptop,
        href: `${base()}/devices?proto=win`,
        keywords: ["win", "windows", "table", "filter"],
        run: go(`${base()}/devices?proto=win`),
      },
      {
        id: "query-android",
        title: "Android devices",
        group: "Queries",
        icon: Laptop,
        href: `${base()}/devices?proto=android`,
        keywords: ["android", "table", "filter"],
        run: go(`${base()}/devices?proto=android`),
      },
    ];

    return [...actions, ...create, ...withShortcuts, ...settings, ...queries];
  });

  /** Turn "devices critical apple" into a filtered device table command. */
  const deviceQuery = createMemo<Command | undefined>(() => {
    const id = tenantId();

    if (!id) return undefined;
    const term = query().trim().toLowerCase();
    const match = /^devices?\b\s*(.*)$/.exec(term);

    if (!match) return undefined;
    const rest = match[1]?.trim() ?? "";

    if (!rest) return undefined;
    const params = new URLSearchParams();
    const words: string[] = [];

    for (const token of rest.split(/\s+/)) {
      if (["critical", "attention", "warning", "healthy", "unknown", "stale"].includes(token)) {
        params.set("health", token === "warning" ? "attention" : token);
        continue;
      }

      if (["apple", "mac", "ios", "ipados"].includes(token)) {
        params.set("proto", "apple");
        continue;
      }

      if (["windows", "win"].includes(token)) {
        params.set("proto", "win");
        continue;
      }

      if (token === "android") {
        params.set("proto", "android");
        continue;
      }

      if (["enrolled", "enrolling", "unenrolling", "unenrolled"].includes(token)) {
        params.set("status", token);
        continue;
      }

      if (["failing", "invalid"].includes(token)) {
        params.set("push", token);
        continue;
      }

      const days = /^(\d+)d$/.exec(token);

      if (days) {
        params.set("staleDays", days[1]!);
        continue;
      }

      words.push(token);
    }

    if (words.length > 0) params.set("q", words.join(" "));

    if ([...params.keys()].length === 0) return undefined;
    const href = `${base()}/devices?${params.toString()}`;

    return {
      id: "query-devices-dynamic",
      title: `Show devices: ${rest}`,
      subtitle: "Build a filtered device table",
      group: "Queries",
      icon: Laptop,
      href,
      run: () => navigate(href),
    };
  });

  const serverItems = createMemo<Command[]>(() => {
    const id = tenantId();

    if (!id || results.status !== "success") return [];

    return (results.data?.rows ?? []).map((row) => {
      if ("proto" in row)
        return {
          id: `device-${row.id}`,
          title: row.name,
          subtitle: [row.serial, row.model].filter(Boolean).join(" · ") || "Device",
          group: "Devices",
          icon: Laptop,
          href: `/t/${id}/devices/${row.id}`,
          run: () => navigate(`/t/${id}/devices/${row.id}`),
        };

      if ("email" in row)
        return {
          id: `person-${row.id}`,
          title: row.name,
          subtitle: `${row.email} · ${row.role}`,
          group: "People",
          icon: User,
          href: `/t/${id}/settings/administrators`,
          run: () => navigate(`/t/${id}/settings/administrators`),
        };

      if ("devicesCount" in row)
        return {
          id: `group-${row.id}`,
          title: row.name,
          subtitle: `${row.devicesCount ?? 0} devices`,
          group: "Groups",
          icon: UsersRound,
          href: `/t/${id}/groups/${row.id}`,
          run: () => navigate(`/t/${id}/groups/${row.id}`),
        };

      return {
        id: `policy-${row.id}`,
        title: row.name,
        subtitle: "Policy",
        group: "Policies",
        icon: ShieldCheck,
        href: `/t/${id}/policies/${row.id}`,
        run: () => navigate(`/t/${id}/policies/${row.id}`),
      };
    });
  });

  const allCommands = createMemo<Command[]>(() => [
    ...registeredCommands(),
    ...builtIn(),
    ...serverItems(),
    ...(deviceQuery() ? [deviceQuery()!] : []),
  ]);

  const matches = (command: Command, term: string) => {
    const tokens = term.split(/\s+/).filter(Boolean);

    const haystack = [
      command.title,
      command.subtitle ?? "",
      command.group,
      ...(command.keywords ?? []),
    ]
      .join(" ")
      .toLowerCase();

    return tokens.every((token) => haystack.includes(token));
  };

  const items = createMemo<Command[]>(() => {
    const term = query().trim().toLowerCase();

    if (!term) {
      const recent: Command[] = recents().map((entry) => ({
        id: entry.id,
        title: entry.title,
        subtitle: entry.hint,
        group: "Recent",
        icon: iconForGroup(entry.group),
        href: entry.href,
        run: () => navigate(entry.href),
      }));

      const seen = new Set(recent.map((entry) => entry.id));
      const pageCommands = registeredCommands();
      const pageIds = new Set(pageCommands.map((command) => command.id));

      const actions = builtIn().filter(
        (command) =>
          (command.group === "Actions" || command.group === "Navigation") &&
          !seen.has(command.id) &&
          !pageIds.has(command.id),
      );

      return [...recent, ...pageCommands, ...actions];
    }

    return allCommands()
      .filter((command) => matches(command, term))
      .slice(0, 50);
  });

  const grouped = createMemo(() => {
    const map = new Map<string, Command[]>();

    for (const item of items()) {
      const list = map.get(item.group) ?? [];
      list.push(item);
      map.set(item.group, list);
    }

    return [...map.entries()].sort(([left], [right]) => groupRank(left) - groupRank(right));
  });

  const remember = (item: Command) => {
    if (!item.href || item.group === "Actions") return;

    const next: Recent[] = [
      {
        id: item.id,
        title: item.title,
        hint: item.subtitle,
        group: item.group,
        href: item.href,
      },
      ...recents().filter((entry) => entry.id !== item.id),
    ].slice(0, 8);

    setRecents(next);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  };

  const rememberOpener = () => {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  };

  const run = (item: Command | undefined) => {
    if (!item) return;
    remember(item);
    setOpen(false);
    setQuery("");
    setDebouncedQuery("");
    setTruncated(false);
    void item.run();
  };

  createEffect(
    () => ({ path: location.pathname, open: open() }),
    ({ open }) => {
      if (!open) setActive(0);
    },
  );

  onSettled(() => {
    let pendingSequence = "";
    let sequenceTimer: ReturnType<typeof setTimeout> | undefined;

    const clearSequence = () => {
      pendingSequence = "";
      clearTimeout(sequenceTimer);
    };

    const sequenceCommands = () =>
      allCommands().filter(
        (command) =>
          command.shortcut?.kind === "sequence" && (!command.enabled || command.enabled()),
      );

    const chordCommands = () =>
      allCommands().filter(
        (command) => command.shortcut?.kind === "chord" && (!command.enabled || command.enabled()),
      );

    const runShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing) return false;
      const editable = isEditableTarget(event.target);
      const mod = event.metaKey || event.ctrlKey;

      for (const command of chordCommands()) {
        const shortcut = command.shortcut;

        if (shortcut?.kind !== "chord") continue;

        if (!matchesChord(shortcut, event)) continue;

        if (editable && !mod) continue;
        event.preventDefault();
        void command.run();
        clearSequence();

        return true;
      }

      if (mod || event.altKey || editable) {
        if (!pendingSequence) return false;
        clearSequence();

        return false;
      }

      const key = event.key.toLowerCase();
      const prefix = pendingSequence + key;
      const commands = sequenceCommands();

      const exact = commands.find(
        (command) =>
          command.shortcut?.kind === "sequence" &&
          command.shortcut.keys.join(" ").toLowerCase() === prefix,
      );

      if (exact) {
        event.preventDefault();
        clearSequence();
        void exact.run();

        return true;
      }

      const hasLonger = commands.some(
        (command) =>
          command.shortcut?.kind === "sequence" &&
          command.shortcut.keys.join(" ").toLowerCase().startsWith(`${prefix} `),
      );

      if (hasLonger) {
        event.preventDefault();
        pendingSequence = `${prefix} `;
        clearTimeout(sequenceTimer);
        sequenceTimer = setTimeout(clearSequence, 1200);

        return true;
      }

      if (pendingSequence) clearSequence();

      const startsSequence = commands.some(
        (command) => command.shortcut?.kind === "sequence" && command.shortcut.keys[0] === key,
      );

      if (startsSequence) {
        event.preventDefault();
        pendingSequence = `${key} `;
        clearTimeout(sequenceTimer);
        sequenceTimer = setTimeout(clearSequence, 1200);

        return true;
      }

      return false;
    };

    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();

        if (!open()) rememberOpener();
        clearSequence();
        setOpen((value) => !value);

        return;
      }

      if (!open() && runShortcut(event)) return;

      if (!open()) return;

      if (event.key === "Escape") {
        setOpen(false);
        clearSequence();
        queueMicrotask(() => opener?.focus({ preventScroll: true }));
      }

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

    const openEvent = () => {
      rememberOpener();
      setOpen(true);
    };

    window.addEventListener("keydown", handler);
    window.addEventListener("mattrax:open-command-palette", openEvent);

    return () => {
      clearTimeout(sequenceTimer);
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

  createEffect(
    () => open(),
    (isOpen) => {
      if (typeof document === "undefined") return;
      const root = document.documentElement;
      const previous = root.style.overflow;

      if (isOpen) root.style.overflow = "hidden";

      return () => {
        root.style.overflow = previous;
      };
    },
  );

  return (
    <Show when={open()}>
      <div
        class="palette-overlay fixed inset-0 z-[60] flex items-start justify-center bg-black/60 px-4 pt-[10vh] backdrop-blur-sm"
        onClick={() => setOpen(false)}
      >
        <div
          ref={card}
          role="dialog"
          aria-modal="true"
          aria-label="Search Mattrax"
          class="palette-card dark w-full max-w-2xl overflow-hidden rounded-lg border border-white/[0.09] bg-popover shadow-2xl shadow-black/70"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key !== "Tab" || !card) return;

            const focusable = Array.from(
              card.querySelectorAll<HTMLElement>("input, button, a[href]"),
            );

            if (focusable.length === 0) return;
            event.preventDefault();
            const current = focusable.indexOf(document.activeElement as HTMLElement);

            const next = event.shiftKey
              ? (current - 1 + focusable.length) % focusable.length
              : (current + 1) % focusable.length;

            focusable[next]?.focus();
          }}
        >
          <div class="flex items-center gap-2 border-b border-white/[0.07] px-4 py-3">
            <Search class="size-4 text-muted-foreground" />
            <input
              ref={input}
              role="combobox"
              aria-expanded="true"
              aria-controls="command-palette-list"
              aria-autocomplete="list"
              aria-label="Search settings, devices, policies, people or commands"
              aria-activedescendant={
                items()[active()] ? `command-palette-option-${active()}` : undefined
              }
              value={query()}
              onInput={(event) => updateQuery(event.currentTarget.value)}
              placeholder="Search settings, devices, people, or run a command…"
              class="flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground sm:text-[14px]"
            />
            <kbd class="rounded border border-white/[0.08] px-1.5 py-0.5 text-[10px] text-muted-foreground">
              esc
            </kbd>
          </div>
          <div id="command-palette-list" role="listbox" class="max-h-[60vh] overflow-auto p-2">
            <Show when={results.error}>
              {(error) => (
                <div
                  role="alert"
                  class="mx-1 mb-2 rounded-md border border-destructive/25 bg-destructive/[0.07] px-3 py-2.5"
                >
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                      <p class="text-[12.5px] font-medium text-foreground">Search failed</p>
                      <p class="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
                        {errorMessage(error(), "Search is unavailable right now.")}
                      </p>
                    </div>
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={results.isFetching}
                      onClick={() => void results.refetch()}
                    >
                      {results.isFetching ? "Retrying…" : "Try again"}
                    </Button>
                  </div>
                </div>
              )}
            </Show>
            <Show
              when={items().length > 0}
              fallback={
                <Show when={!results.error}>
                  <div class="px-3 py-8 text-center">
                    <p class="text-[13px] text-muted-foreground">No results.</p>
                    <p class="mt-1 text-[11px] text-muted-foreground/70">
                      Try a device, policy, person, setting or a query like “devices critical”.
                    </p>
                  </div>
                </Show>
              }
            >
              <For each={grouped()}>
                {([group, groupItems]) => (
                  <div class="mb-1">
                    <p class="px-3 py-1.5 text-[11px] font-medium text-muted-foreground">{group}</p>
                    <For each={groupItems}>
                      {(item) => {
                        const index = () => items().indexOf(item);

                        return (
                          <button
                            type="button"
                            role="option"
                            id={`command-palette-option-${index()}`}
                            aria-selected={active() === index() ? "true" : "false"}
                            onMouseEnter={() => setActive(index())}
                            onClick={() => run(item)}
                            class={cn(
                              "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-[13px]",
                              active() === index() ? "bg-white/[0.07]" : "hover:bg-white/[0.04]",
                            )}
                          >
                            <Show when={item.icon}>
                              {(icon) => {
                                const Icon = icon();

                                return <Icon class="size-4 shrink-0 text-muted-foreground" />;
                              }}
                            </Show>
                            <span class="min-w-0 flex-1">
                              <span class="block truncate font-[450] text-foreground">
                                {item.title}
                              </span>
                              <Show when={item.subtitle}>
                                <span class="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
                                  {item.subtitle}
                                </span>
                              </Show>
                            </span>
                            <Show when={item.shortcut}>
                              {(shortcut) => (
                                <kbd class="shrink-0 rounded border border-white/[0.08] bg-white/[0.025] px-1.5 py-0.5 font-sans text-[10px] text-muted-foreground">
                                  {shortcutLabel(shortcut())}
                                </kbd>
                              )}
                            </Show>
                          </button>
                        );
                      }}
                    </For>
                  </div>
                )}
              </For>
            </Show>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.07] px-4 py-2 text-[11px] text-muted-foreground">
            <span>↑↓ navigate · ↵ run · esc close</span>
            <Show when={truncated()} fallback={<span>Shortcuts work outside this menu</span>}>
              <span>Showing first {SEARCH_LIMIT} matches</span>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}
