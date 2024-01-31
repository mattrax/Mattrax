import { For, Suspense, createEffect, createSignal, untrack } from "solid-js";
import { useBeforeLeave } from "@solidjs/router";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "~/components/ui";
import { useGlobalCtx } from "~/lib/globalCtx";
import { trpc } from "~/lib";
import { DeleteTenantButton } from "./DeleteTenantButton";

export default function Page() {
  return (
    <div class="p-4 grid grid-rows-3 grid-cols-3 gap-4">
      <SettingsCard />
      <AdministratorsCard />
      <BillingCard />
      <AuthenticationCard />
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
  return (
    <Card class="w-[350px]">
      <CardHeader>
        <CardTitle>Tenant Authentication</CardTitle>
        <CardDescription>
          Manage external authentication providers.
        </CardDescription>
      </CardHeader>
      <CardContent class="flex flex-col space-y-2">
        {/* <Button class="w-full">Link with EntraID</Button> */}

        <p>Linked with: Entra ID</p>
        {/* TODO: Link to the Microsoft dashboard in the correct tenant */}
        <p>
          Last Synced: <span>Wed Jan 31 2024 11:42:16</span>
        </p>

        <Button class="w-full" onClick={() => alert("TODO: Trigger sync")}>
          Force Sync
        </Button>
        <Button
          class="w-full"
          variant="destructive"
          onClick={() =>
            alert("Unlinking not supported, yet! Please contact support!")
          }
        >
          Unlink
        </Button>
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
  return (
    <Card class="w-[350px]">
      <CardHeader>
        <CardTitle>Billing</CardTitle>
        <CardDescription>The lights don't power themselves</CardDescription>
      </CardHeader>
      <CardContent class="flex flex-col space-y-2">
        <p>Devices: 0</p>
        <Button disabled class="w-full">
          Go to Stipe
        </Button>
      </CardContent>
    </Card>
  );
}
