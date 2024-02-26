import { For, Show, createEffect, createSignal } from "solid-js";
import { z } from "zod";
import { RouterOutput } from "~/api";
import { useTenantContext } from "~/app/(dash)/[tenantId]";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
  Input,
  Textarea,
  createController,
} from "~/components/ui";
import { trpc } from "~/lib";
import { useZodParams } from "~/lib/useZodParams";
import { match, P } from "ts-pattern";
import { Form, InputField, createZodForm } from "~/components/forms";
import { As } from "@kobalte/core";

export default function Page() {
  const tenant = useTenantContext();
  const params = useZodParams({
    policyId: z.string(),
  });
  const policy = trpc.policy.get.useQuery(() => ({
    tenantId: tenant.activeTenant.id,
    policyId: params.policyId,
  }));
  const versions = trpc.policy.getVersions.useQuery(() => ({
    tenantId: tenant.activeTenant.id,
    policyId: params.policyId,
  }));
  const createVersion = trpc.policy.createVersion.useMutation(() => ({
    onSuccess: () => versions.refetch(),
  }));

  // TODO: Track deploys in UI

  return (
    <div class="flex flex-col space-y-2">
      <h2 class="text-2xl font-bold mb-4">Versions</h2>
      <Show when={policy.data}>
        {(policyData) => (
          <>
            <For each={versions.data ?? []}>
              {(version, i) => (
                <div class="flex flex-col space-y-2">
                  <VersionRow
                    disabled={versions.isLoading}
                    refetchVersion={async () => {
                      await versions.refetch();
                    }}
                    refetchPolicy={async () => {
                      await policy.refetch();
                    }}
                    policy={policyData()}
                    version={version}
                  />
                  {i() === versions.data!.length && (
                    <div class="flex w-full justify-center select-none disabled:opacity-70">
                      <IconPhArrowCircleDownBold class="text-2xl transition" />
                    </div>
                  )}
                </div>
              )}
            </For>
            <div
              class="flex w-full justify-center select-none"
              classList={{
                "opacity-70":
                  policyData().activeVersion === undefined ||
                  policyData().activeVersion?.status === "open",
              }}
            >
              <IconPhPlusCircleBold
                class="text-2xl transition"
                onClick={() => {
                  if (
                    policyData().activeVersion === undefined ||
                    policyData().activeVersion?.status === "open"
                  )
                    return;

                  createVersion.mutate({
                    tenantId: tenant.activeTenant.id,
                    policyId: policyData().id,
                  });
                }}
              />
            </div>
          </>
        )}
      </Show>
    </div>
  );
}

function VersionRow(props: {
  disabled: boolean;
  policy: RouterOutput["policy"]["get"];
  refetchVersion: () => Promise<void>;
  refetchPolicy: () => Promise<void>;
  version: RouterOutput["policy"]["getVersions"][number];
}) {
  const tenant = useTenantContext();
  const updateVersion = trpc.policy.updateVersion.useMutation(() => ({
    onSuccess: props.refetchVersion,
  }));
  const form = createZodForm({
    schema: z.object({
      uri: z.string(),
      value: z.string(),
    }),
    onSubmit: (values) =>
      updateVersion.mutateAsync({
        tenantId: tenant.activeTenant.id,
        policyId: props.policy.id,
        versionId: props.version.id,
        data: {
          ...(props.version.data || {}),
          windows: {
            ...((props.version.data as any)?.windows || {}),
            [values.value.uri]: values.value.value,
          },
        },
      }),
  });

  const isDisabled = () =>
    props.disabled ||
    updateVersion.isPending ||
    props.version.status !== "open";

  return (
    <Card>
      <CardHeader class="flex-row justify-between">
        <div class="flex space-x-2 justify-center items-center">
          <CardTitle>{props.version.id}</CardTitle>
          <div>
            {match(props.version.status)
              .with("open", () => <></>)
              .with("deploying", () => (
                <Badge variant="default" class="animate-pulse">
                  Deploying
                </Badge>
              ))
              .with("deployed", () => <Badge variant="default">Deployed</Badge>)
              .exhaustive()}
          </div>
        </div>

        <DeployButton
          policyId={props.policy.id}
          version={props.version}
          refetch={async () => {
            props.refetchVersion();
            props.refetchPolicy();
          }}
        />
      </CardHeader>
      <CardContent class="flex flex-col space-y-4">
        <div>
          <Show when={props.version.status !== "open"}>
            <p>
              Deployed by {props.version.deployedBy} with comment '
              {props.version.deployComment}' at{" "}
              {props.version.deployedAt?.toString()}
            </p>
          </Show>

          <h1 class="text-md font-semibold leading-none tracking-tight py-2">
            Windows
          </h1>
          <div class="flex flex-col space-y-3">
            <For
              each={Object.entries((props.version.data as any)?.windows || {})}
            >
              {([uri, value]) => (
                <div class="flex space-x-3">
                  <Input
                    value={uri}
                    class="flex-1"
                    disabled={isDisabled() || true}
                  />
                  <Input
                    value={value as string}
                    class="flex-1"
                    disabled={isDisabled() || true}
                  />
                  <Button
                    variant="destructive"
                    class="w-16"
                    disabled={isDisabled()}
                    onClick={() => {
                      const windows = {
                        ...((props.version.data as any)?.windows || {}),
                      };
                      delete windows[uri];
                      updateVersion.mutateAsync({
                        tenantId: tenant.activeTenant.id,
                        policyId: props.policy.id,
                        versionId: props.version.id,
                        data: {
                          ...(props.version.data || {}),
                          windows,
                        },
                      });
                    }}
                  >
                    Delete
                  </Button>
                </div>
              )}
            </For>

            <Form form={form} fieldsetClass="flex space-x-3">
              <div class="flex-1">
                <InputField
                  form={form}
                  name="uri"
                  placeholder="./Device/Vendor/MSFT/Policy/Config/Camera/AllowCamera"
                  disabled={isDisabled()}
                  onDblClick={(e) => {
                    form.setFieldValue("uri", e.currentTarget.placeholder);
                  }}
                />
              </div>
              <div class="flex-1">
                <InputField
                  form={form}
                  name="value"
                  placeholder="0"
                  disabled={isDisabled()}
                  onDblClick={(e) => {
                    form.setFieldValue("value", e.currentTarget.placeholder);
                  }}
                />
              </div>
              <Button class="w-16" disabled={isDisabled()}>
                Add
              </Button>
            </Form>
          </div>
        </div>
        <div>
          <h1 class="text-md font-semibold leading-none tracking-tight py-2">
            Apple
          </h1>

          <div class="flex justify-between">
            <input
              type="file"
              class="disabled:opacity-70"
              accept=".mobileconfig"
              disabled={isDisabled()}
              onInput={(e) => {
                const file = e.currentTarget.files?.[0];
                if (!file) return;
                file.text().then((text) => {
                  updateVersion.mutateAsync({
                    tenantId: tenant.activeTenant.id,
                    policyId: props.policy.id,
                    versionId: props.version.id,
                    data: {
                      ...(props.version.data || {}),
                      apple: text,
                    },
                  });
                });
              }}
            />

            <Button
              variant="destructive"
              onClick={() => {
                const data = { ...(props.version.data || {}) };
                if ("apple" in data) delete data.apple;
                updateVersion.mutateAsync({
                  tenantId: tenant.activeTenant.id,
                  policyId: props.policy.id,
                  versionId: props.version.id,
                  data,
                });
              }}
              disabled={isDisabled()}
            >
              Delete
            </Button>
          </div>

          <Show when={(props.version.data as any)?.apple}>
            {(value) => <pre>{value()}</pre>}
          </Show>
        </div>

        <div>
          <h1 class="text-md font-semibold leading-none tracking-tight py-2">
            Android
          </h1>
          <h2 class="text-muted-foreground opacity-70">Coming soon...</h2>
        </div>

        <div>
          <h1 class="text-md font-semibold leading-none tracking-tight py-2">
            Linux
          </h1>
          <h2 class="text-muted-foreground opacity-70">Coming soon...</h2>
        </div>
      </CardContent>
    </Card>
  );
}

function DeployButton(props: {
  policyId: string;
  version: RouterOutput["policy"]["getVersions"][number];
  refetch: () => Promise<void>;
}) {
  const tenant = useTenantContext();
  const controller = createController();
  const [page, setPage] = createSignal(0);
  const [comment, setComment] = createSignal("");
  const deployVersion = trpc.policy.deployVersion.useMutation(() => ({
    onSuccess: async () => {
      await props.refetch();
      controller.setOpen(false);
    },
  }));

  createEffect(() => controller.open() && setPage(0));

  const numberOfScopedDevices = 5; // TODO: Work this out from the backend

  return (
    <DialogRoot controller={controller}>
      <DialogTrigger asChild>
        {/* // TODO: Disable this button if the policies data matches the previous versions */}
        <As component={Button} disabled={props.version.status !== "open"}>
          Deploy
        </As>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Deploy changes</DialogTitle>
          <DialogDescription>
            Would you like to deploy the following changes to{" "}
            <b>{numberOfScopedDevices}</b> devices?
          </DialogDescription>
        </DialogHeader>

        {page() === 0 && (
          <>
            <ul class="list-disc pl-4 text-md leading-none tracking-tight text-semibold flex flex-col space-y-2">
              {/* // TODO: Proper diff */}
              <li>
                <p>Generic changes</p>
              </li>
              {/* <li>
                <p>Modified script 'Punish bad users'</p>
              </li>
              <li>
                <p>Added Slack configuration</p>
              </li> */}
            </ul>

            <Button type="button" onClick={() => setPage(1)}>
              Confirm Changes
            </Button>
          </>
        )}
        {page() === 1 && (
          <>
            <Textarea
              placeholder="Provide some context to your team!"
              value={comment()}
              onChange={(e) => setComment(e.currentTarget.value)}
            />
            <Button
              variant="destructive"
              onClick={() =>
                deployVersion.mutate({
                  tenantId: tenant.activeTenant.id,
                  policyId: props.policyId,
                  comment: comment(),
                })
              }
            >
              Deploy to {numberOfScopedDevices} devices
            </Button>
          </>
        )}
      </DialogContent>
    </DialogRoot>
  );
}
