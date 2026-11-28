import { For } from "solid-js";
import { PERMISSIONS, PERMISSION_GROUPS } from "@mattrax/enterprise-domain/client";
import type { Permission } from "@mattrax/enterprise-domain/client";
import { Input } from "@mattrax/ui";
import { Button } from "@mattrax/ui";

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
export default function PermissionPicker(props: {
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

  return (
    <div class="rounded-lg border border-border">
      <div class="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span class="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Permissions
        </span>
        <div class="flex overflow-hidden rounded-md border border-border">
          <Button
            type="button"
            variant={allState() === "none" ? "default" : "ghost"}
            size="xs"
            onClick={() => setAll("none")}
          >
            No access
          </Button>
          <Button
            type="button"
            variant={allState() === "read" ? "default" : "ghost"}
            size="xs"
            onClick={() => setAll("read")}
          >
            Read
          </Button>
          <Button
            type="button"
            variant={allState() === "write" ? "default" : "ghost"}
            size="xs"
            onClick={() => setAll("write")}
          >
            All access
          </Button>
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
                <summary class="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs hover:bg-hover [&::-webkit-details-marker]:hidden">
                  <span class="min-w-0">
                    <span class="font-medium text-foreground">{group.label}</span>
                    <span class="ml-1.5 text-xs text-muted-foreground">
                      {group.permissions.length}
                    </span>
                  </span>
                  <span class="flex shrink-0 overflow-hidden rounded-md border border-border">
                    <Button
                      type="button"
                      variant={state() === "none" ? "default" : "ghost"}
                      size="xs"
                      onClick={(event: MouseEvent) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setGroup(group, "none");
                      }}
                    >
                      None
                    </Button>
                    <Button
                      type="button"
                      variant={state() === "read" ? "default" : "ghost"}
                      size="xs"
                      onClick={(event: MouseEvent) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setGroup(group, "read");
                      }}
                    >
                      Read
                    </Button>
                    {hasWrite() ? (
                      <Button
                        type="button"
                        variant={state() === "write" ? "default" : "ghost"}
                        size="xs"
                        onClick={(event: MouseEvent) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setGroup(group, "write");
                        }}
                      >
                        Write
                      </Button>
                    ) : null}
                  </span>
                </summary>
                <div class="grid gap-1 px-3 pb-2">
                  <For each={group.permissions}>
                    {(permission) => (
                      <label class="flex items-start gap-2 text-xs text-muted-foreground">
                        <Input
                          type="checkbox"
                          class="mt-0.5"
                          checked={selected().has(permission.id)}
                          onChange={(event) => toggle(permission.id, event.currentTarget.checked)}
                        />
                        <span class="min-w-0">
                          <span class="block text-foreground">{permission.label}</span>
                          <span class="block text-xs leading-snug">
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
