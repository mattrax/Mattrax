import { For, Suspense } from "solid-js";
import dayjs from "dayjs";
import { toast } from "solid-sonner";
import { z } from "zod";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Switch,
} from "~/components/ui";
import { trpc, untrackScopeFromSuspense } from "~/lib";
import { DeleteTenantButton } from "./DeleteTenantButton";
import { authProviderDisplayName, authProviderUrl } from "~/lib/values";
import { Form, createZodForm } from "~/components/forms";
import { InputField } from "~/components/forms/InputField";
import { useAuthContext } from "~/app/(dash)";
import { useTenantContext } from "../../[tenant]";
import { ConfirmDialog } from "~/components/ConfirmDialog";

export default function Page() {
  return (
    <div class="flex flex-col gap-4">
      <SettingsCard />
      <AuthenticationCard />
      <ConfigureEnrollmentCard />
      <MigrateCard />
      <DeleteTenantCard />
    </div>
  );
}

function SettingsCard() {
  const auth = useAuthContext();
  const tenant = useTenantContext();

  // TODO: rollback form on failure
  const updateTenant = trpc.tenant.edit.useMutation(() => ({
    onSuccess: () => auth.meQuery.refetch(),
  }));

  const form = createZodForm({
    schema: z.object({ name: z.string() }),
    defaultValues: {
      name: tenant.activeTenant.name,
    },
    async onSubmit({ value }) {
      await updateTenant.mutateAsync({
        name: value.name,
        tenantId: tenant.activeTenant.id,
      });
    },
  });

  return (
    <Card class="flex flex-col">
      <CardHeader>
        <CardTitle>Tenant Settings</CardTitle>
        <CardDescription>Basic tenant configuration.</CardDescription>
      </CardHeader>
      <Form form={form}>
        <CardContent class="flex-grow flex flex-col justify-between">
          <InputField form={form} name="name" label="Name" />
        </CardContent>
        <CardFooter>
          <Button type="submit">Save</Button>
        </CardFooter>
      </Form>
    </Card>
  );
}

function AuthenticationCard() {
  const tenant = useTenantContext();
  const linkedProviders = trpc.tenant.auth.query.useQuery(() => ({
    tenantId: tenant.activeTenant.id,
  }));

  const linkEntra = trpc.tenant.auth.linkEntra.useMutation(() => ({
    onSuccess: async (url) => {
      window.open(url, "_self");

      // Make sure the button is disabled until the user is in the new tab
      await new Promise((resolve) => setTimeout(resolve, 500));
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

  const isQueryPending = untrackScopeFromSuspense(
    () => linkedProviders.isPending
  );
  const isPending = () =>
    isQueryPending() || linkEntra.isPending || sync.isPending;

  const hasLinkedProviders = untrackScopeFromSuspense(
    () => linkedProviders.data?.length === 0
  );

  return (
    <Card>
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
              {(provider) => (
                <div class="border-b">
                  <h1 class="text-xl">
                    {authProviderDisplayName(provider.name)}
                  </h1>
                  <p>
                    <a
                      href={authProviderUrl(provider.name, provider.resourceId)}
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

                  <ConfirmDialog>
                    {(confirm) => {
                      const unlinkProvider =
                        trpc.tenant.auth.unlink.useMutation(() => ({
                          onSuccess: async () => {
                            await linkedProviders.refetch();
                            // TODO: Refetch user's if the query is active
                          },
                        }));

                      return (
                        <Button
                          variant="destructive"
                          class="w-full"
                          onClick={() =>
                            confirm({
                              title: "Unlink Entra",
                              inputText: "Unlink Entra",
                              action: "Unlink Entra",
                              description: (
                                <>
                                  Are you sure you want to unlink your auth
                                  provider along with all <b>users</b> and{" "}
                                  <b>groups</b> assigned to it?
                                </>
                              ),
                              async onConfirm() {
                                await unlinkProvider.mutateAsync({
                                  id: provider.id,
                                  tenantId: tenant.activeTenant.id,
                                });
                              },
                            })
                          }
                        >
                          Unlink
                        </Button>
                      );
                    }}
                  </ConfirmDialog>
                </div>
              )}
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
                    linkEntra.mutate({ tenantId: tenant.activeTenant.id });
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
            onClick={() =>
              sync.mutate({
                tenantId: tenant.activeTenant.id,
              })
            }
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
    <Card>
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

function ConfigureEnrollmentCard() {
  const tenant = useTenantContext();

  const enrollmentInfo = trpc.tenant.enrollmentInfo.useQuery(() => ({
    tenantId: tenant.activeTenant.id,
  }));
  // TODO: Show correct state on the UI while the mutation is pending but keep fields disabled.
  const setEnrollmentInfo = trpc.tenant.setEnrollmentInfo.useMutation(() => ({
    onSuccess: () => enrollmentInfo.refetch(),
  }));
  const enrollmentEnabled = untrackScopeFromSuspense(
    () => enrollmentInfo.data?.enrollmentEnabled
  );

  return (
    <Card>
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
                tenantId: tenant.activeTenant.id,
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

function DeleteTenantCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Delete Tenant</CardTitle>
        <CardDescription>
          Permanently delete your tenant and all its data.
        </CardDescription>
      </CardHeader>
      <CardFooter>
        <DeleteTenantButton />
      </CardFooter>
    </Card>
  );
}
