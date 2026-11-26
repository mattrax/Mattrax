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
  Skeleton,
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

export default function UserDropdown(props: UserDropdownProps) {
  return (
    <Show
      when={!props.pending}
      fallback={<Skeleton class={props.placeholderClass ?? "size-7"} />}
    >
      <Show
        when={props.user}
        fallback={
          props.signInHref ? (
            <Button as="a" href={props.signInHref} size="sm" class="touch-target">
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
                "flex size-7 items-center justify-center overflow-hidden "
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

            <DropdownMenuContent class={props.contentClass ?? "w-62"}>
              <DropdownMenuGroup>
                <div class="flex items-center gap-2.5 px-2 py-2">
                  <Avatar size="sm" class="size-6">
                    <Show
                      when={user().image}
                      fallback={<span aria-hidden="true">{getInitials(user().name ?? "?")}</span>}
                    >
                      <img src={user().image!} alt="" class="size-full object-cover" />
                    </Show>
                  </Avatar>
                  <div class="min-w-0">
                    <DropdownMenuLabel class="block h-auto">
                      {user().name}
                    </DropdownMenuLabel>
                    <p class="mt-0.5 truncate text-xs text-muted-foreground">{user().email}</p>
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
                <LogOut class="size-3.5" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </Show>
    </Show>
  );
}
