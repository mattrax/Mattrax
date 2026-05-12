import { LogOut } from "lucide-solid";
import { Show } from "solid-js";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

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
            props.placeholderClass ?? "h-8 w-8 rounded-full bg-stone-200 opacity-50 animate-pulse"
          }
        />
      }
    >
      <Show
        when={props.user}
        fallback={
          props.signInHref ? (
            <Button as="a" href={props.signInHref} size="sm" class="rounded-full h-52 text-white">
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
                "flex h-8 w-8 items-center justify-center rounded-full overflow-hidden bg-stone-900 text-stone-50 text-xs font-semibold hover:ring-2 hover:ring-stone-300 hover:ring-offset-1 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400 focus-visible:ring-offset-2"
              }
              aria-label="Account menu"
            >
              <Show when={user().image} fallback={<span>{getInitials(user().name ?? "?")}</span>}>
                <img
                  src={user().image!}
                  alt={user().name ?? ""}
                  class="h-full w-full object-cover"
                />
              </Show>
            </DropdownMenuTrigger>

            <DropdownMenuContent
              class={
                props.contentClass ??
                "w-56 rounded-xl border border-stone-200 bg-white p-1 shadow-lg overflow-hidden"
              }
            >
              <div class="px-3 py-2 border-b border-stone-100">
                <p class="text-sm font-medium text-stone-900 truncate">{user().name}</p>
                <p class="text-xs text-stone-500 truncate mt-0.5">{user().email}</p>
              </div>

              <div class="pt-1">
                <Show when={props.showDashboardLink}>
                  <DropdownMenuItem
                    as="a"
                    href="/dashboard"
                    class="rounded-lg px-3 py-2 text-sm text-stone-700 hover:bg-stone-50 transition-colors"
                  >
                    Dashboard
                  </DropdownMenuItem>
                </Show>
                <DropdownMenuItem
                  onSelect={() => props.onSignOut()}
                  class="rounded-lg px-3 py-2 text-sm text-stone-700 hover:bg-stone-50 transition-colors"
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
