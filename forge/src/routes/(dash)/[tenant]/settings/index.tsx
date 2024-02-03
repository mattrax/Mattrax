import { For, Suspense, createEffect, createSignal, untrack } from "solid-js";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Label,
  Switch,
} from "~/components/ui";
import dayjs from "dayjs";
import { useGlobalCtx } from "~/lib/globalCtx";
import { trpc } from "~/lib";
import { DeleteTenantButton } from "./DeleteTenantButton";
import { authProviderDisplayName, authProviderUrl } from "~/lib/values";
import { toast } from "solid-sonner";

export default function Page() {
  return (
    <div class="p-4 grid grid-rows-3 grid-cols-3 gap-4">
      <SettingsCard />
      <AdministratorsCard />
      <BillingCard />
      <AuthenticationCard />
      <ConfigureEnrollmentCard />
      <MigrateCard />
    </div>
  );
}

function SettingsCard() {
  const globalCtx = useGlobalCtx();
  const [defaultValue, setDefaultValue] = createSignal(
    globalCtx.activeTenant!.name
  );
  const [input, setInput] = createSignal(defaultValue());

  createEffect(() => {
    const tenantName = globalCtx.activeTenant!.name;
    if (tenantName !== untrack(() => defaultValue())) {
      setDefaultValue(tenantName);
      setInput(tenantName);
    } else {
      // TODO: Handle this
    }
  });

  // TODO: Build into form abstraction
  // useBeforeLeave((e) => {
  //   if (form.isDirty && !e.defaultPrevented) {
  //     // preventDefault to block immediately and prompt user async
  //     e.preventDefault();
  //     setTimeout(() => {
  //       if (window.confirm("Discard unsaved changes - are you sure?")) {
  //         // user wants to proceed anyway so retry with force=true
  //         e.retry(true);
  //       }
  //     }, 100);
  //   }
  // });

  return (
    <Card class="w-[350px] flex flex-col">
      <CardHeader>
        <CardTitle>Tenant Settings</CardTitle>
        <CardDescription>Basic tenant configuration.</CardDescription>
      </CardHeader>
      <CardContent class="flex-grow flex flex-col justify-between">
        <div>
          <div class="grid w-full items-center gap-4">
            <div class="flex flex-col space-y-1.5">
              <Label for="name">Name</Label>
              <Input
                id="name"
                value={input()}
                onInput={(e) => setInput(e.currentTarget.value)}
              />
            </div>
            <div class="flex flex-col space-y-1.5">
              <Label for="description">Description</Label>
              <Input
                id="description"
                // value={input()}
                // onInput={(e) => setInput(e.currentTarget.value)}
                disabled
              />
            </div>
          </div>

          <Button class="mt-4 w-full">Save</Button>
        </div>

        <DeleteTenantButton />
      </CardContent>
    </Card>
  );
}

function AdministratorsCard() {
  const administrators = trpc.tenant.administrators.useQuery();

  return (
    <Card class="w-[350px] flex flex-col">
      <CardHeader>
        <CardTitle>Tenant Administrators</CardTitle>
        <CardDescription>Manage administrator users.</CardDescription>
      </CardHeader>
      <CardContent class="flex-grow flex flex-col justify-between">
        <Suspense fallback={<p>Loading...</p>}>
          <div>
            <For each={administrators.data}>
              {(administrator) => (
                <div class="flex justify-between">
                  <div>
                    <p class="text-sm">{administrator.name}</p>
                    <p class="text-sm text-muted-foreground">
                      {administrator.email}
                    </p>
                  </div>
                  <div>
                    {/* TODO: Tooltip when disabled */}
                    <Button
                      variant="destructive"
                      onClick={() => alert("TODO")}
                      disabled={administrator.isOwner}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Suspense>

        <div>
          <Button class="w-full" onClick={() => alert("TODO")}>
            Invite
          </Button>
        </div>

        {/* // TODO: Promote new owner */}

        {/* // TODO: Show & allow deleting in-progress invitation */}
      </CardContent>
    </Card>
  );
}

function AuthenticationCard() {
  const linkedProviders = trpc.tenant.auth.query.useQuery();
  const linkEntra = trpc.tenant.auth.linkEntra.useMutation(() => ({
    onSuccess: async (url) => {
      window.open(url, "_self");

      // Make sure the button is disabled until the user is in the new tab
      await new Promise((resolve) => setTimeout(resolve, 500));
    },
  }));
  const unlinkProvider = trpc.tenant.auth.unlink.useMutation(() => ({
    onSuccess: async () => {
      await linkedProviders.refetch();
    },
  }));
  const sync = trpc.tenant.auth.sync.useMutation(() => ({
    onSuccess: async () =>
      toast.success("Sync complete!", {
        id: "tenant-user-sync",
      }),
  }));

  const isPending = () =>
    linkedProviders.isPending || linkEntra.isPending || sync.isPending;

  return (
    <Card class="w-[350px] flex flex-col">
      <CardHeader>
        <CardTitle>Tenant Authentication</CardTitle>
        <CardDescription>
          Manage external authentication providers.
        </CardDescription>
      </CardHeader>
      <CardContent class="flex-grow flex flex-col justify-between space-y-2">
        <div>
          <Suspense fallback={<p>Loading...</p>}>
            {linkedProviders.data?.length === 0 ? (
              <p>No linked providers...</p>
            ) : null}

            <For each={linkedProviders.data}>
              {(provider) => {
                return (
                  <div class="border-b">
                    <h1 class="text-xl">
                      {authProviderDisplayName(provider.name)}
                    </h1>
                    <p>
                      <a
                        href={authProviderUrl(
                          provider.name,
                          provider.resourceId
                        )}
                        target="_blank"
                        rel="external"
                        class="hover:opacity-85 hover:underline"
                      >
                        {provider.resourceId}
                      </a>
                    </p>

                    <p>
                      Last Synced:{" "}
                      <span>
                        {provider.lastSynced
                          ? dayjs(provider.lastSynced).fromNow()
                          : "Never synced"}
                      </span>
                    </p>

                    {/* // TODO: Delete button confirmation */}
                    <Button
                      class="w-full"
                      variant="destructive"
                      onClick={() =>
                        unlinkProvider.mutate({
                          id: provider.id,
                        })
                      }
                    >
                      Unlink
                    </Button>
                  </div>
                );
              }}
            </For>
          </Suspense>
        </div>

        <div class="flex flex-col space-y-2">
          <DropdownMenu>
            <DropdownMenuTrigger
              as={Button}
              disabled={isPending()}
              class="w-full"
            >
              Link Provider
            </DropdownMenuTrigger>
            {/* TODO: Make dropdown width the same as the button */}
            <DropdownMenuContent>
              {/* TODO: Warning about double login */}
              <DropdownMenuItem
                onClick={() => {
                  if (
                    confirm(
                      "You will be asked to provide consent twice. This is expected and is to ensure your data is kept secure though the process!"
                    )
                  )
                    linkEntra.mutate();
                }}
              >
                <IconLogosMicrosoftAzure class="mr-3" />
                Microsoft Entra ID
              </DropdownMenuItem>
              <DropdownMenuItem disabled>
                <IconLogosGoogleIcon class="mr-3" />
                Google Workspaces
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            class="w-full"
            onClick={() => sync.mutate()}
            disabled={isPending() || linkedProviders.data?.length === 0}
          >
            Sync
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function MigrateCard() {
  return (
    <Card class="w-[350px]">
      <CardHeader>
        <CardTitle>Migrate to Mattrax</CardTitle>
        <CardDescription>
          Easily migrate from your existing MDM.
        </CardDescription>
      </CardHeader>
      <CardContent class="flex flex-col space-y-2">
        <Button disabled class="w-full">
          Migrate From Intune
        </Button>
        <Button disabled class="w-full">
          Migrate From Jamf
        </Button>
      </CardContent>
    </Card>
  );
}

function BillingCard() {
  const stripePortalUrl = trpc.tenant.billing.portalUrl.useMutation(() => ({
    onSuccess: async (url) => {
      window.open(url, "_self");

      // Make sure the button is disabled until the user is in the new tab
      await new Promise((resolve) => setTimeout(resolve, 500));
    },
  }));

  return (
    <Card class="w-[350px]">
      <CardHeader>
        <CardTitle>Billing</CardTitle>
        <CardDescription>The lights don't power themselves</CardDescription>
      </CardHeader>
      <CardContent class="flex flex-col space-y-2">
        <p>Devices: 0</p>
        {/* TODO: How much is owed and when it's due */}

        <Button
          class="w-full"
          onClick={() => stripePortalUrl.mutate()}
          disabled={stripePortalUrl.isPending}
        >
          Go to Stipe
        </Button>
      </CardContent>
    </Card>
  );
}

function ConfigureEnrollmentCard() {
  return (
    <Card class="w-[350px]">
      <CardHeader>
        <CardTitle>Enrollment</CardTitle>
        <CardDescription>Configure how devices can enrollment</CardDescription>
      </CardHeader>
      <CardContent class="flex flex-col space-y-2">
        <div class="flex justify-between">
          <p>Enable enrollment</p>
          <Switch checked={true} />
        </div>

        {/* // TODO: Integrate with Apple DEP */}
        {/* // TODO: Integrate with Apple user-initiated enrollment */}
        {/* // TODO: Integrate with Microsoft user-initiated enrollment */}
        {/* // TODO: Integrate with Android user-initiated enrollment */}
      </CardContent>
    </Card>
  );
}
