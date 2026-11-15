import { Show } from "solid-js";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { LogOut } from "~/components/ui/icons";

type DropdownUser = {
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

type UserDropdownProps = {
  user?: DropdownUser | null;
  pending?: boolean;
  onSignOut: () => void | Promise<void>;
  signInHref?: string;
  showDashboardLink?: boolean;
  triggerClass?: string;
  placeholderClass?: string;
  contentClass?: string;
};

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/);

  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();

  return parts[0]?.[0]?.toUpperCase() ?? "?";
}

export function UserDropdown(props: UserDropdownProps) {
  return (
    <Show
      when={!props.pending}
      fallback={
        <div
          class={
            props.placeholderClass ?? "size-7 rounded-full bg-white/[0.08] opacity-50 animate-pulse"
          }
        />
      }
    >
      <Show
        when={props.user}
        fallback={
          props.signInHref ? (
            <Button
              as="a"
              href={props.signInHref}
              size="sm"
              class="h-8 rounded-md bg-foreground px-3 text-[12.5px] !text-[#08080a] hover:bg-foreground/90"
            >
              Sign in
            </Button>
          ) : null
        }
      >
        {(user) => (
          <DropdownMenu placement="bottom-end">
            <DropdownMenuTrigger
              class={
                props.triggerClass ??
                "flex size-7 items-center justify-center overflow-hidden rounded-full bg-white/[0.08] text-[10px] font-semibold text-foreground ring-1 ring-inset ring-white/[0.1] transition-shadow hover:ring-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              }
              aria-label={
                user().image ? "Account menu" : `${getInitials(user().name ?? "?")}, account menu`
              }
            >
              <Show when={user().image} fallback={<span aria-hidden="true">{getInitials(user().name ?? "?")}</span>}>
                <img src={user().image!} alt="" class="h-full w-full object-cover" />
              </Show>
            </DropdownMenuTrigger>

            <DropdownMenuContent
              class={
                props.contentClass ??
                "w-[248px] overflow-hidden rounded-lg border border-white/[0.09] bg-[#232326] p-0.5 shadow-[0_8px_24px_rgba(0,0,0,.45),0_2px_6px_rgba(0,0,0,.3),inset_0_0_0_1px_rgba(255,255,255,.02)]"
              }
            >
              <DropdownMenuGroup>
                <div class="px-2 py-2">
                  <DropdownMenuLabel class="block truncate text-[13px] font-medium text-foreground">
                    {user().name}
                  </DropdownMenuLabel>
                  <p class="mt-0.5 truncate text-[11px] text-muted-foreground">{user().email}</p>
                </div>
              </DropdownMenuGroup>

              <div class="pt-1">
                <Show when={props.showDashboardLink}>
                  <DropdownMenuItem
                    as="a"
                    href="/dashboard"
                    class="flex h-8 items-center rounded-[5px] px-2 text-[12.5px] text-foreground outline-none focus:bg-white/[0.07]"
                  >
                    Dashboard
                  </DropdownMenuItem>
                </Show>
                <DropdownMenuItem
                  onSelect={() => props.onSignOut()}
                  class="flex h-8 items-center rounded-[5px] px-2 text-[12.5px] text-foreground outline-none focus:bg-white/[0.07]"
                >
                  <LogOut class="mr-2 size-4" />
                  Sign out
                </DropdownMenuItem>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </Show>
    </Show>
  );
}
