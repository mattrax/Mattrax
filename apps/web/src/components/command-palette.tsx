import { useLocation } from "@solidjs/router";
import { useNavigate } from "~/lib/navigation";
import { Option, Schema } from "effect";
import { useQuery } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, For, onCleanup, onSettled, Show } from "solid-js";
import { Button } from "~/components/ui/button";
import { useTenantRouteParams } from "~/lib/route-params";
import { routes } from "~/lib/routes";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  Activity,
  BookOpen,
  Laptop,
  LayoutDashboard,
  LogOut,
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
import { errorMessage, raisedFailure } from "~/lib/errors";
import { reportGlobalError } from "~/lib/global-errors";
import {
  SETTINGS_READ_PERMISSIONS,
  settingsTabPermission,
  tenantSectionPermission,
  useCan,
} from "~/lib/permissions";
import { cn } from "~/lib/utils";

const RECENTS_KEY = "mattrax:recents";

const SEARCH_LIMIT = 30;

type Recent = { id: string; title: string; hint?: string; group: string; href: string };

const StoredRecent = Schema.Struct({
  id: Schema.String,
  title: Schema.optional(Schema.String),
  label: Schema.optional(Schema.String),
  hint: Schema.optional(Schema.String),
  group: Schema.String,
  href: Schema.String,
});

const decodeRecents = Schema.decodeUnknownOption(Schema.Array(StoredRecent));

function readRecents(): Recent[] {
  try {
    const parsed = Option.getOrUndefined(
      decodeRecents(JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]")),
    );

    if (parsed === undefined) return [];

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
  const tenantParams = useTenantRouteParams();
  const [open, setOpen] = createSignal(false);
  const { can, canAny } = useCan();
  const [query, setQuery] = createSignal("");
  const [debouncedQuery, setDebouncedQuery] = createSignal("");
  const [active, setActive] = createSignal(0);
  let opener: HTMLElement | null = null;
  const [recents, setRecents] = createSignal(readRecents());
  const tenantId = () => tenantParams.tenantId;

  const tenant = () => {
    const id = tenantId();

    return id ? routes.tenant(id) : undefined;
  };

  const base = () => tenant()?.overview() ?? "";
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
            reportGlobalError(raisedFailure(error));

            return;
          }

          window.location.assign("/login");
        },
      },
    ];

    if (!id) return actions;

    const nav = (command: Command) => ({ ...command, href: command.href ?? undefined });

    const tenantRoutes = routes.tenant(id);

    const navigation: Command[] = [
      nav(
        navigable("nav-overview", "Overview", tenantRoutes.overview(), go(tenantRoutes.overview())),
      ),
      nav(
        navigable(
          "nav-dashboards",
          "Dashboards",
          tenantRoutes.dashboards(),
          go(tenantRoutes.dashboards()),
        ),
      ),
      nav(navigable("nav-devices", "Devices", tenantRoutes.devices(), go(tenantRoutes.devices()))),
      nav(navigable("nav-groups", "Groups", tenantRoutes.groups(), go(tenantRoutes.groups()))),
      nav(
        navigable("nav-policies", "Policies", tenantRoutes.policies(), go(tenantRoutes.policies())),
      ),
      nav(
        navigable(
          "nav-applications",
          "Applications",
          tenantRoutes.applications(),
          go(tenantRoutes.applications()),
        ),
      ),
      nav(navigable("nav-scripts", "Scripts", tenantRoutes.scripts(), go(tenantRoutes.scripts()))),
      nav(
        navigable("nav-settings", "Settings", tenantRoutes.settings(), go(tenantRoutes.settings())),
      ),
    ];

    const shortcuts = new Map<string, CommandShortcut>([
      ["nav-overview", sequence("g", "o")],
      ["nav-dashboards", sequence("g", "b")],
      ["nav-devices", sequence("g", "d")],
      ["nav-groups", sequence("g", "g")],
      ["nav-policies", sequence("g", "p")],
      ["nav-applications", sequence("g", "a")],
      ["nav-scripts", sequence("g", "s")],
      ["nav-settings", sequence("g", "t")],
    ]);

    const withShortcuts = navigation.flatMap((command) => {
      if (command.id === "nav-settings") {
        if (!canAny(SETTINGS_READ_PERMISSIONS)) return [];
      } else {
        const section = command.id.replace("nav-", "");
        const required = tenantSectionPermission(section);

        if (required && !can(required)) return [];
      }

      const shortcut = shortcuts.get(command.id);

      return [shortcut ? { ...command, shortcut } : command];
    });

    const create: Command[] = [
      {
        id: "new-policy",
        title: "Create policy",
        group: "Actions",
        icon: Plus,
        href: routes.tenant(id).newPolicy(),
        keywords: ["new", "add", "policy"],
        shortcut: sequence("n", "p"),
        run: go(routes.tenant(id).newPolicy()),
      },
      {
        id: "new-group",
        title: "Create group",
        group: "Actions",
        icon: Plus,
        href: routes.tenant(id).newGroup(),
        keywords: ["new", "add", "group"],
        shortcut: sequence("n", "g"),
        run: go(routes.tenant(id).newGroup()),
      },
      {
        id: "new-dashboard",
        title: "Create dashboard",
        group: "Actions",
        icon: Plus,
        href: routes.tenant(id).dashboards(),
        keywords: ["new", "add", "dashboard", "overview", "widget"],
        shortcut: sequence("n", "d"),
        run: go(routes.tenant(id).dashboards()),
      },
      {
        id: "new-script",
        title: "Create script",
        group: "Actions",
        icon: Plus,
        href: `/t/${id}/scripts/new`,
        keywords: ["new", "add", "script", "automation", "shell"],
        shortcut: sequence("n", "s"),
        run: go(`/t/${id}/scripts/new`),
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

    const settings: Command[] = (
      [
        {
          key: "general",
          title: "General settings",
          keywords: ["profile", "branding", "name", "slug"],
          path: "general",
        },
        {
          key: "members",
          title: "Members",
          keywords: ["people", "users", "invite", "roles", "administrators"],
          path: "administrators",
        },
        {
          key: "identity",
          title: "Identity & SSO",
          keywords: ["sso", "scim", "entra", "directory", "single sign-on"],
          path: "identity",
        },
        {
          key: "enrollment",
          title: "Enrollment settings",
          keywords: ["enroll", "onboarding", "link"],
          path: "enrollment",
        },
        {
          key: "management",
          title: "Device management",
          keywords: ["apns", "apple push", "scep", "android", "certificate"],
          path: "management",
        },
        {
          key: "delivery",
          title: "Apple push delivery",
          keywords: ["apns", "push", "failing", "invalid token", "diagnostics"],
          path: "delivery",
        },
        {
          key: "integrations",
          title: "Integrations",
          keywords: ["webhooks", "events", "api"],
          path: "integrations",
        },
        {
          key: "audit",
          title: "Audit log",
          keywords: ["events", "history", "export"],
          path: "audit",
        },
        {
          key: "billing",
          title: "Billing",
          keywords: ["plan", "invoice", "stripe", "usage"],
          path: "billing",
        },
      ] satisfies ReadonlyArray<{
        key: string;
        title: string;
        keywords: ReadonlyArray<string>;
        path: string;
      }>
    ).map(({ key, title, keywords, path }) => ({
      id: `settings-${key}`,
      title,
      group: "Settings",
      icon: Settings,
      href: `${base()}/settings/${path === "general" ? "" : path}`.replace(/\/$/, ""),
      keywords,
      run: go(`${base()}/settings/${path === "general" ? "" : path}`.replace(/\/$/, "")),
    }));

    const queries: Command[] = [
      {
        id: "query-attention",
        title: "Devices needing attention",
        group: "Queries",
        icon: Laptop,
        href: routes.tenant(id).devices({ health: "attention" }),
        keywords: ["unhealthy", "warning", "attention", "table", "filter"],
        run: go(routes.tenant(id).devices({ health: "attention" })),
      },
      {
        id: "query-critical",
        title: "Critical devices",
        group: "Queries",
        icon: Laptop,
        href: routes.tenant(id).devices({ health: "critical" }),
        keywords: ["unhealthy", "critical", "table", "filter"],
        run: go(routes.tenant(id).devices({ health: "critical" })),
      },
      {
        id: "query-stale",
        title: "Devices not seen in 7 days",
        group: "Queries",
        icon: Laptop,
        href: routes.tenant(id).devices({ health: "stale" }),
        keywords: ["stale", "offline", "not checking in", "table", "filter"],
        run: go(routes.tenant(id).devices({ health: "stale" })),
      },
      {
        id: "query-push-failing",
        title: "Apple push failures",
        group: "Queries",
        icon: Laptop,
        href: routes.tenant(id).devices({ push: "failing" }),
        keywords: ["apns", "push", "failing", "invalid", "table", "filter"],
        run: go(routes.tenant(id).devices({ push: "failing" })),
      },
      {
        id: "query-apple",
        title: "Apple devices",
        group: "Queries",
        icon: Laptop,
        href: routes.tenant(id).devices({ proto: "apple" }),
        keywords: ["mac", "ios", "ipados", "apple", "table", "filter"],
        run: go(routes.tenant(id).devices({ proto: "apple" })),
      },
      {
        id: "query-windows",
        title: "Windows devices",
        group: "Queries",
        icon: Laptop,
        href: routes.tenant(id).devices({ proto: "win" }),
        keywords: ["win", "windows", "table", "filter"],
        run: go(routes.tenant(id).devices({ proto: "win" })),
      },
      {
        id: "query-android",
        title: "Android devices",
        group: "Queries",
        icon: Laptop,
        href: routes.tenant(id).devices({ proto: "android" }),
        keywords: ["android", "table", "filter"],
        run: go(routes.tenant(id).devices({ proto: "android" })),
      },
    ];

    return [
      ...actions,
      ...create.filter((command) => {
        if (command.id === "new-policy") return can("policies.write");

        if (command.id === "new-group") return can("groups.write");

        if (command.id === "new-dashboard") return can("dashboards.write");

        if (command.id === "new-script") return can("scripts.write");

        return true;
      }),
      ...withShortcuts,
      ...settings.filter((command) => {
        const key = command.id.replace("settings-", "");

        return can(settingsTabPermission(key));
      }),
      ...(can("devices.read") ? queries : []),
    ];
  });

  /** Turn "devices critical apple" into a filtered device table command. */
  const deviceQuery = createMemo<Command | undefined>(() => {
    const id = tenantId();

    if (!id || !can("devices.read")) return undefined;
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

    return (results.data?.rows ?? []).flatMap((row): Command[] => {
      if ("proto" in row) {
        if (!can("devices.read")) return [];

        return [
          {
            id: `device-${row.id}`,
            title: row.name,
            subtitle: [row.serial, row.model].filter(Boolean).join(" · ") || "Device",
            group: "Devices",
            icon: Laptop,
            href: routes.tenant(id).device(row.id),
            run: () => navigate(routes.tenant(id).device(row.id)),
          },
        ];
      }

      if ("email" in row) {
        if (!can("members.read")) return [];

        return [
          {
            id: `person-${row.id}`,
            title: row.name,
            subtitle: `${row.email} · ${row.role}`,
            group: "People",
            icon: User,
            href: routes.tenant(id).settingsAdministrators(),
            run: () => navigate(routes.tenant(id).settingsAdministrators()),
          },
        ];
      }

      if ("devicesCount" in row) {
        if (!can("groups.read")) return [];

        return [
          {
            id: `group-${row.id}`,
            title: row.name,
            subtitle: `${row.devicesCount ?? 0} devices`,
            group: "Groups",
            icon: UsersRound,
            href: routes.tenant(id).group(row.id),
            run: () => navigate(routes.tenant(id).group(row.id)),
          },
        ];
      }

      if (!can("policies.read")) return [];

      return [
        {
          id: `policy-${row.id}`,
          title: row.name,
          subtitle: "Policy",
          group: "Policies",
          icon: ShieldCheck,
          href: routes.tenant(id).policy(row.id),
          run: () => navigate(routes.tenant(id).policy(row.id)),
        },
      ];
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

  /**
   * Close and restore focus. The dialog is mounted only while open (see the
   * render), so the primitive's own close-auto-focus cannot run; we return to
   * the element that opened the palette, falling back to the main landmark
   * when that element has left the page (for example after a navigation).
   */
  let focusMainOnClose = false;

  const close = () => {
    setOpen(false);

    const target = focusMainOnClose ? undefined : opener;

    focusMainOnClose = false;
    requestAnimationFrame(() => {
      (target?.isConnected ? target : document.getElementById("main"))?.focus({
        preventScroll: true,
      });
    });
  };

  /**
   * Selection is remembered through this variable rather than a signal write:
   * writing palette state in the same tick as a navigation cancels Solid
   * Router's transition, so the route change would never commit. The close
   * effect records it after the navigation settles.
   */
  let pendingRecent: Command | undefined;

  const resetSearch = () => {
    setQuery("");
    setDebouncedQuery("");
    setTruncated(false);
  };

  /** Run a non-navigation command and close the palette. */
  const runAction = (item: Command) => {
    pendingRecent = item;

    // Let the command's own handler run before the dialog unmounts.
    void item.run();
    queueMicrotask(close);
  };

  const run = (item: Command | undefined) => {
    if (!item) return;

    if (item.href) {
      // Anchor clicks navigate through the router's document handler; this
      // branch serves the keyboard (Enter) and direct invocation.
      pendingRecent = item;
      navigate(item.href);

      return;
    }

    runAction(item);
  };

  /**
   * One polite announcement for the search lifecycle. It is derived from the
   * debounced term and the query state, so typing does not produce a message
   * per keystroke.
   */
  const statusText = createMemo(() => {
    if (!debouncedQuery()) return "";

    if (results.isFetching) return "Searching…";

    if (results.error) return "Search failed.";

    const count = items().length;

    if (count === 0) return "No results.";

    return `${count} result${count === 1 ? "" : "s"}${
      truncated() ? `, showing the first ${SEARCH_LIMIT}` : ""
    }.`;
  });

  createEffect(
    () => ({ path: location.pathname, open: open() }),
    ({ open }) => {
      if (open) return;

      const selected = pendingRecent;
      pendingRecent = undefined;

      setActive(0);
      resetSearch();

      if (!selected) return;

      try {
        remember(selected);
      } catch {
        // Recents are a convenience; storage may be unavailable or full.
      }
    },
  );

  createEffect(
    () => items().length,
    (length) => {
      if (length > 0 && active() >= length) setActive(length - 1);

      if (length === 0 && active() !== 0) setActive(0);
    },
  );

  // Close after the router commits a navigation. Closing in the command
  // handler's own tick cancels the transition in Solid Router 2.
  createEffect(
    () => ({ path: location.pathname, search: location.search }),
    (next, previous) => {
      if (!previous || !open()) return;

      if (next.path !== previous.path || next.search !== previous.search) close();
    },
  );

  // Kobalte's dismissable layer stops Escape in the capture phase before it
  // reaches the combobox in this RC. Close from the window capture handler.
  createEffect(
    () => open(),
    (isOpen) => {
      if (!isOpen || typeof window === "undefined") return;

      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== "Escape") return;

        event.preventDefault();
        event.stopPropagation();
        close();
      };

      window.addEventListener("keydown", onKeyDown, true);
      onCleanup(() => window.removeEventListener("keydown", onKeyDown, true));
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
        clearSequence();

        if (open()) {
          close();
        } else {
          rememberOpener();
          setOpen(true);
        }

        return;
      }

      if (!open() && runShortcut(event)) return;
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

  // Kobalte's focus scope mounts the portal before it can take focus, so the
  // input is focused on the next frame; the dialog remains the trap owner.
  createEffect(
    () => open(),
    (isOpen) => {
      if (!isOpen) return;

      requestAnimationFrame(() => input?.focus({ preventScroll: true }));
    },
  );

  /** Keys belong to the dialog while it is open, so they run in the event. */
  const onContentKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();

      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((value) => Math.min(value + 1, Math.max(0, items().length - 1)));

      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((value) => Math.max(value - 1, 0));

      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      run(items()[active()]);
    }
  };

  const groupDomId = (group: string) =>
    `command-palette-group-${group.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  return (
    <>
      <Show when={open()}>
        {/*
        A fresh uncontrolled dialog per open. The window shortcut and the header
        button both flip `open`, and mounting the primitive fresh keeps its own
        open state authoritative while it is on screen (Escape, light dismiss and
        command selection all unmount it).
      */}
        <Dialog defaultOpen onOpenChange={(next) => !next && setOpen(false)}>
          <DialogContent
            data-slot="command-palette"
            showCloseButton={false}
            class="palette-card !top-[10vh] !translate-y-0 w-[calc(100vw-2rem)] max-w-2xl gap-0 overflow-hidden p-0"
            onKeyDown={onContentKeyDown}
          >
            <DialogTitle class="sr-only">Search Mattrax</DialogTitle>
            <DialogDescription class="sr-only">
              Search settings, devices, policies, people, and commands. Use the arrow keys to move
              through results and Enter to run the highlighted one.
            </DialogDescription>

              <div class="flex items-center gap-2 border-b border-border px-4 py-3">
                <Search class="size-4 text-muted-foreground" />
                <input
                  ref={(element) => {
                    input = element;
                  }}
                  role="combobox"
                  aria-expanded={items().length > 0 ? "true" : "false"}
                  aria-controls="command-palette-list"
                  aria-autocomplete="list"
                  aria-label="Search settings, devices, policies, people or commands"
                  aria-activedescendant={
                    items()[active()] ? `command-palette-option-${active()}` : undefined
                  }
                  value={query()}
                  onInput={(event) => updateQuery(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      close();

                      return;
                    }

                    if (event.key !== "Enter" || event.isComposing) return;

                    // Some primitives stop Enter before it bubbles to the dialog,
                    // so run the active item directly from the combobox.
                    event.preventDefault();
                    run(items()[active()]);
                  }}
                  placeholder="Search or run a command…"
                  class="flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground sm:text-[14px]"
                />
                <kbd class="hidden rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline">
                  esc
                </kbd>
              </div>

              <Show when={results.error}>
                {(error) => (
                  <div
                    role="alert"
                    class="mx-3 mt-2 rounded-md border border-destructive/25 bg-destructive/[0.07] px-3 py-2.5"
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

              <div class="max-h-[calc(100dvh-10rem)] overflow-auto overscroll-contain p-2">
                <div
                  id="command-palette-list"
                  role="listbox"
                  aria-label="Search results"
                  aria-busy={results.isFetching ? "true" : undefined}
                >
                  <For each={grouped()}>
                    {([group, groupItems]) => (
                      <div role="group" aria-labelledby={groupDomId(group)} class="mb-1">
                        <p
                          id={groupDomId(group)}
                          class="px-3 py-1.5 text-[11px] font-medium text-muted-foreground"
                        >
                          {group}
                        </p>
                        <For each={groupItems}>
                          {(item) => {
                            const index = () => items().indexOf(item);

                            return (
                              <a
                                href={item.href ?? "#"}
                                role="option"
                                tabindex="-1"
                                id={`command-palette-option-${index()}`}
                                aria-selected={active() === index() ? "true" : "false"}
                                onClick={(event) => {
                                  if (item.href) {
                                    // Remember after the route change commits;
                                    // writing palette state here would cancel the
                                    // router's transition.
                                    pendingRecent = item;

                                    // Selecting the page already on screen does
                                    // not change the location, so the close
                                    // effect never runs; close here instead.
                                    const target = new URL(item.href, window.location.href);

                                    if (
                                      target.pathname === location.pathname &&
                                      target.search === location.search
                                    ) {
                                      event.preventDefault();
                                      close();
                                    }

                                    return;
                                  }

                                  event.preventDefault();
                                  runAction(item);
                                }}
                                class={cn(
                                  "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-[13px]",
                                  active() === index() ? "bg-hover" : "hover:bg-hover",
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
                                    <kbd class="hidden shrink-0 rounded border border-border bg-surface px-1.5 py-0.5 font-sans text-[10px] text-foreground/75 sm:inline">
                                      {shortcutLabel(shortcut())}
                                    </kbd>
                                  )}
                                </Show>
                              </a>
                            );
                          }}
                        </For>
                      </div>
                    )}
                  </For>
                </div>

                <Show when={items().length === 0 && !results.error}>
                  <div class="px-3 py-8 text-center">
                    <p class="text-[13px] text-muted-foreground">No results.</p>
                    <p class="mt-1 text-[11px] text-muted-foreground">
                      Try a device, policy, person, setting or a query like “devices critical”.
                    </p>
                  </div>
                </Show>
              </div>

              <div role="status" aria-live="polite" aria-atomic="true" class="sr-only">
                {statusText()}
              </div>

              <div class="hidden flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2 text-[11px] text-muted-foreground sm:flex">
                <span class="hidden sm:inline">↑↓ navigate · ↵ run · esc close</span>
                <Show
                  when={truncated()}
                  fallback={<span class="hidden sm:inline">Shortcuts work outside this menu</span>}
                >
                  <span>Showing first {SEARCH_LIMIT} matches</span>
                </Show>
              </div>
            </DialogContent>
        </Dialog>
      </Show>
    </>
  );
}
