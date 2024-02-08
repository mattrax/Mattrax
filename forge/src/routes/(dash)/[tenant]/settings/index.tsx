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
import { trpc, untrackScopeFromSuspense } from "~/lib";
import { DeleteTenantButton } from "./DeleteTenantButton";
import { authProviderDisplayName, authProviderUrl } from "~/lib/values";
import { toast } from "solid-sonner";
import { OutlineLayout } from "../OutlineLayout";

export default function Page() {
  return (
    <OutlineLayout title="Settings">
      <div class="flex flex-row">
        <div class="grid grid-cols-3 gap-4">
          <SettingsCard />
          <AdministratorsCard />
          <BillingCard />
          <AuthenticationCard />
          <ConfigureEnrollmentCard />
          <MigrateCard />
        </div>
        <div class="flex-1" />
      </div>
    </OutlineLayout>
  );
}

function SettingsCard() {
  const globalCtx = useGlobalCtx();
  const [defaultValue, setDefaultValue] = createSignal(
    globalCtx.activeTenant?.name
  );
  const [input, setInput] = createSignal(defaultValue());

  const [defaultValue2, setDefaultValue2] = createSignal(
    globalCtx.activeTenant?.description
  );
  const [input2, setInput2] = createSignal(defaultValue2());

  // TODO: rollback form on failure
  const updateTenant = trpc.tenant.edit.useMutation(() => ({
    onSuccess: () => globalCtx.refetchSession(),
  }));

  createEffect(() => {
    const tenantName = globalCtx.activeTenant!.name;
    if (tenantName !== untrack(() => defaultValue())) {
      setDefaultValue(tenantName);
      setInput(tenantName);
    } else {
      // TODO: Handle this
    }

    const tenantDescription = globalCtx.activeTenant!.description;
    if (tenantDescription !== untrack(() => defaultValue2())) {
      setDefaultValue2(tenantName);
      setInput2(tenantDescription);
    } else {
      // TODO: Handle this
    }
  });

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
                placeholder="My cool organization"
                value={input2()}
                onInput={(e) => setInput2(e.currentTarget.value)}
              />
            </div>
          </div>

          <Button
            class="mt-4 w-full mb-2"
            onClick={() => {
              const data = {};
              if (input() !== untrack(() => defaultValue()))
                data["name"] = input();
              if (input2() !== untrack(() => defaultValue2()))
                data["description"] = input2() === "" ? null : input2();
              updateTenant.mutate(data);
            }}
          >
            Save
          </Button>
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
      <CardContent
        class={"flex-grow flex flex-col justify-between" + " blur-sm p-8"}
      >
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
                      disabled={true && administrator.isOwner}
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
          <Button class="w-full" onClick={() => alert("TODO")} disabled>
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
      // TODO: Refetch user's if the query is active
    },
  }));
  const sync = trpc.tenant.auth.sync.useMutation(() => ({
    onSuccess: async () => {
      toast.success("Sync complete!", {
        id: "tenant-user-sync",
      });
      // TODO: Refetch user's if the query is active
    },
  }));

  const isPending = () =>
    linkedProviders.isPending || linkEntra.isPending || sync.isPending;

  const hasLinkedProviders = untrackScopeFromSuspense(
    () => linkedProviders.data?.length === 0
  );

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
            // disabled={isPending() || hasLinkedProviders()}
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
        <p>While Mattrax is beta, it's free!</p>
        {/* <p>Devices: 0</p> */}
        {/* TODO: How much is owed and when it's due */}

        {/* <Button
          class="w-full"
          onClick={() => stripePortalUrl.mutate()}
          disabled={stripePortalUrl.isPending}
        >
          Go to Stipe
        </Button> */}
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
