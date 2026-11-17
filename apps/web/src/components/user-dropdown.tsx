import { Show } from "solid-js";
import {
  Avatar,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@mattrax/ui";
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
          class={props.placeholderClass ?? "size-7 animate-pulse rounded-full bg-hover opacity-50"}
        />
      }
    >
      <Show
        when={props.user}
        fallback={
          props.signInHref ? (
            <Button as="a" href={props.signInHref} size="sm">
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
                "flex size-7 items-center justify-center overflow-hidden rounded-full bg-hover text-[10px] font-[600] text-foreground ring-1 ring-inset ring-border outline-none transition-[box-shadow] duration-150 ease-swift hover:ring-border-strong focus-visible:ring-[3px] focus-visible:ring-ring/30"
              }
              aria-label={
                user().image ? "Account menu" : `${getInitials(user().name ?? "?")}, account menu`
              }
            >
              <Show
                when={user().image}
                fallback={<span aria-hidden="true">{getInitials(user().name ?? "?")}</span>}
              >
                <img src={user().image!} alt="" class="size-full object-cover" />
              </Show>
            </DropdownMenuTrigger>

            <DropdownMenuContent class={props.contentClass ?? "w-[248px]"}>
              <DropdownMenuGroup>
                <div class="flex items-center gap-2.5 px-2 py-2">
                  <Avatar size="sm" class="size-6 text-[9px]">
                    <Show
                      when={user().image}
                      fallback={<span aria-hidden="true">{getInitials(user().name ?? "?")}</span>}
                    >
                      <img src={user().image!} alt="" class="size-full object-cover" />
                    </Show>
                  </Avatar>
                  <div class="min-w-0">
                    <DropdownMenuLabel class="block h-auto truncate py-0 text-[12.5px] font-[550] normal-case tracking-normal text-foreground">
                      {user().name}
                    </DropdownMenuLabel>
                    <p class="mt-0.5 truncate text-[11px] text-muted-foreground">{user().email}</p>
                  </div>
                </div>
              </DropdownMenuGroup>

              <Show when={props.showDashboardLink}>
                <DropdownMenuItem as="a" href="/dashboard">
                  Dashboard
                </DropdownMenuItem>
              </Show>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => props.onSignOut()}>
                <LogOut class="size-3.5 text-muted-foreground" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </Show>
    </Show>
  );
}
