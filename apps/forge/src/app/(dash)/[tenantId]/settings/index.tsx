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
  Switch,
} from "~/components/ui";
import { trpc, untrackScopeFromSuspense } from "~/lib";
import { DeleteTenantButton } from "./DeleteTenantButton";
import { Form, createZodForm } from "~/components/forms";
import { InputField } from "~/components/forms/InputField";
import { useAuthContext } from "~/app/(dash)";
import { useTenantContext } from "../../[tenantId]";

export default function Page() {
  return (
    <div class="flex flex-col gap-4">
      <SettingsCard />
      <ConfigureEnrollmentCard />
      {/* <MigrateCard /> */}
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
