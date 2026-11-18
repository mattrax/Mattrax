import { For } from "solid-js";
import { PERMISSIONS, PERMISSION_GROUPS, type Permission } from "@mattrax/enterprise-domain/client";
import { cn } from "~/lib/utils";

type Level = "none" | "read" | "write";

const groupLevel = (
  permissions: ReadonlyArray<{ id: Permission }>,
  selected: ReadonlySet<Permission>,
): Level | "partial" => {
  const chosen = permissions.filter((permission) => selected.has(permission.id));

  if (chosen.length === 0) return "none";

  if (chosen.length === permissions.length) return "write";

  const reads = permissions.filter((permission) => permission.id.endsWith(".read"));
  const writes = permissions.filter((permission) => !permission.id.endsWith(".read"));

  if (
    reads.every((permission) => selected.has(permission.id)) &&
    writes.every((permission) => !selected.has(permission.id))
  )
    return "read";

  return "partial";
};

/**
 * Reusable permission grid for API tokens and MCP consent.
 *
 * The same catalogue, grouping and read/write semantics are used by the server
 * (`credentialPermissions`) so a picker can never invent a grant the API would
 * interpret differently.
 */
export function PermissionPicker(props: {
  available: ReadonlyArray<Permission>;
  selected: ReadonlyArray<Permission>;
  onChange: (permissions: ReadonlyArray<Permission>) => void;
}) {
  const available = () => new Set(props.available);
  const selected = () => new Set(props.selected);

  const groups = () =>
    PERMISSION_GROUPS.map((group) => ({
      ...group,
      permissions: group.permissions.filter((permission) => available().has(permission.id)),
    })).filter((group) => group.permissions.length > 0);

  const emit = (next: ReadonlySet<Permission>) =>
    props.onChange(PERMISSIONS.filter((permission) => next.has(permission)));

  const setGroup = (group: (typeof PERMISSION_GROUPS)[number], level: Level) => {
    const next = new Set(selected());

    for (const permission of group.permissions) {
      next.delete(permission.id);

      if (level === "write" || (level === "read" && permission.id.endsWith(".read")))
        next.add(permission.id);
    }

    emit(next);
  };

  const toggle = (permission: Permission, checked: boolean) => {
    const next = new Set(selected());

    if (checked) next.add(permission);
    else next.delete(permission);

    emit(next);
  };

  const setAll = (level: Level) => {
    const next = new Set<Permission>();

    for (const permission of props.available)
      if (level === "write" || (level === "read" && permission.endsWith(".read")))
        next.add(permission);

    emit(next);
  };

  const allState = (): Level | "partial" => {
    const items = props.available.map((id) => ({ id }));

    return items.length === 0 ? "none" : groupLevel(items, selected());
  };

  const levelClass = (active: boolean) =>
    cn(
      "px-2 py-1 text-[11px] transition-colors first:rounded-l-md last:rounded-r-md",
      active
        ? "bg-foreground text-background font-medium"
        : "text-muted-foreground hover:bg-hover hover:text-foreground",
    );

  return (
    <div class="rounded-lg border border-border">
      <div class="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span class="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          Permissions
        </span>
        <div class="flex overflow-hidden rounded-md border border-border">
          <button
            type="button"
            class={levelClass(allState() === "none")}
            onClick={() => setAll("none")}
          >
            No access
          </button>
          <button
            type="button"
            class={levelClass(allState() === "read")}
            onClick={() => setAll("read")}
          >
            Read
          </button>
          <button
            type="button"
            class={levelClass(allState() === "write")}
            onClick={() => setAll("write")}
          >
            All access
          </button>
        </div>
      </div>
      <div class="max-h-64 overflow-y-auto">
        <For each={groups()}>
          {(group) => {
            const state = () => groupLevel(group.permissions, selected());

            const hasWrite = () =>
              group.permissions.some((permission) => !permission.id.endsWith(".read"));

            return (
              <details class="group border-b border-border last:border-b-0">
                <summary class="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-[12px] hover:bg-hover [&::-webkit-details-marker]:hidden">
                  <span class="min-w-0">
                    <span class="font-medium text-foreground">{group.label}</span>
                    <span class="ml-1.5 text-[10.5px] text-muted-foreground">
                      {group.permissions.length}
                    </span>
                  </span>
                  <span class="flex shrink-0 overflow-hidden rounded-md border border-border">
                    <button
                      type="button"
                      class={levelClass(state() === "none")}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setGroup(group, "none");
                      }}
                    >
                      None
                    </button>
                    <button
                      type="button"
                      class={levelClass(state() === "read")}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setGroup(group, "read");
                      }}
                    >
                      Read
                    </button>
                    {hasWrite() ? (
                      <button
                        type="button"
                        class={levelClass(state() === "write")}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setGroup(group, "write");
                        }}
                      >
                        Write
                      </button>
                    ) : null}
                  </span>
                </summary>
                <div class="grid gap-1 px-3 pb-2">
                  <For each={group.permissions}>
                    {(permission) => (
                      <label class="flex items-start gap-2 text-[11.5px] text-muted-foreground">
                        <input
                          type="checkbox"
                          class="mt-0.5 accent-foreground"
                          checked={selected().has(permission.id)}
                          onChange={(event) => toggle(permission.id, event.currentTarget.checked)}
                        />
                        <span class="min-w-0">
                          <span class="block text-foreground">{permission.label}</span>
                          <span class="block text-[10.5px] leading-snug">
                            {permission.description}
                          </span>
                        </span>
                      </label>
                    )}
                  </For>
                </div>
              </details>
            );
          }}
        </For>
      </div>
    </div>
  );
}
