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
  Switch,
} from "~/components/ui";
import dayjs from "dayjs";
import { useGlobalCtx } from "~/lib/globalCtx";
import { trpc, untrackScopeFromSuspense } from "~/lib";
import { DeleteTenantButton } from "./DeleteTenantButton";
import { authProviderDisplayName, authProviderUrl } from "~/lib/values";
import { toast } from "solid-sonner";
import { OutlineLayout } from "../OutlineLayout";
import { AreYouSureModal } from "~/components/AreYouSureModal";
import { As } from "@kobalte/core";
import { Form, createZodForm } from "~/components/forms";
import { z } from "zod";
import { InputField } from "~/components/forms/InputField";

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
  // TODO: rollback form on failure
  const updateTenant = trpc.tenant.edit.useMutation(() => ({
    onSuccess: () => globalCtx.refetchSession(),
  }));

  const form = createZodForm({
    schema: z.object({ name: z.string(), description: z.string() }),
    defaultValues: globalCtx.activeTenant ?? undefined,
    async onSubmit(props) {
      await updateTenant.mutateAsync(props.value);
    },
  });

  return (
    <Card class="w-[350px] flex flex-col">
      <CardHeader>
        <CardTitle>Tenant Settings</CardTitle>
        <CardDescription>Basic tenant configuration.</CardDescription>
      </CardHeader>
      <CardContent class="flex-grow flex flex-col justify-between">
        <Form form={form}>
          <div class="grid w-full items-center gap-4">
            <InputField form={form} name="name" label="Name" />
            <InputField
              form={form}
              name="description"
              label="Description"
              placeholder="My cool organization"
            />
          </div>

          <Button type="submit" class="mt-4 w-full mb-2">
            Save
          </Button>
        </Form>

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

                    <AreYouSureModal
                      stringToType="Unlink Entra"
                      description={
                        <>
                          Are you sure you want to unlink your auth provider
                          along with all <b>users</b> and <b>groups</b> assigned
                          to it?
                        </>
                      }
                      mutate={() =>
                        unlinkProvider.mutateAsync({
                          id: provider.id,
                        })
                      }
                    >
                      <As
                        component={Button}
                        variant="destructive"
                        class="w-full"
                      >
                        Unlink
                      </As>
                    </AreYouSureModal>
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
            disabled={isPending() || hasLinkedProviders()}
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
  const enrollmentInfo = trpc.tenant.enrollmentInfo.useQuery();
  // TODO: Show correct state on the UI while the mutation is pending but keep fields disabled.
  const setEnrollmentInfo = trpc.tenant.setEnrollmentInfo.useMutation(() => ({
    onSuccess: () => enrollmentInfo.refetch(),
  }));
  const enrollmentEnabled = untrackScopeFromSuspense(
    () => enrollmentInfo.data?.enrollmentEnabled
  );

  return (
    <Card class="w-[350px]">
      <CardHeader>
        <CardTitle>Enrollment</CardTitle>
        <CardDescription>Configure how devices can enrollment</CardDescription>
      </CardHeader>
      <CardContent class="flex flex-col space-y-2">
        <div class="flex justify-between">
          <p>Enable enrollment</p>
          <Switch
            checked={enrollmentEnabled() ?? true}
            disabled={enrollmentEnabled() === undefined}
            onChange={(state) =>
              setEnrollmentInfo.mutate({
                enrollmentEnabled: state,
              })
            }
          />
        </div>

        {/* // TODO: Integrate with Apple DEP */}
        {/* // TODO: Integrate with Apple user-initiated enrollment */}
        {/* // TODO: Integrate with Microsoft user-initiated enrollment */}
        {/* // TODO: Integrate with Android user-initiated enrollment */}
      </CardContent>
    </Card>
  );
}
