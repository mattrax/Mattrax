import { z } from "zod";
import { toast } from "solid-sonner";
import { A, Navigate } from "@solidjs/router";
import { ParentProps, Show, createSignal } from "solid-js";

import { trpc } from "~/lib";
import { useZodParams } from "~/lib/useZodParams";
import { useTenantContext } from "../../[tenantId]";
import { AUTH_PROVIDER_DISPLAY, userAuthProviderUrl } from "~/lib/values";
import {
  Button,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
  buttonVariants,
} from "~/components/ui";
import clsx from "clsx";
import { As } from "@kobalte/core";
import { Form, InputField, createZodForm } from "~/components/forms";

function UserNotFound() {
  toast.error("User not found");
  // necessary since '..' adds trailing slash -_-
  return <Navigate href="../../users" />;
}

export default function Page() {
  const tenant = useTenantContext();
  const params = useZodParams({
    userId: z.string(),
  });
  const user = trpc.user.get.useQuery(() => ({
    tenantId: tenant.activeTenant.id,
    id: params.userId,
  }));

  return (
    <Show when={user.data !== undefined}>
      <Show when={user.data} fallback={<UserNotFound />}>
        {(user) => (
          <div class="px-4 py-8 w-full max-w-5xl mx-auto flex flex-col gap-4">
            <div class="flex flex-row justify-between">
              <div>
                <h1 class="text-3xl font-bold">{user().name}</h1>
                <span class="block mt-1 text-gray-700 text-sm">
                  {user().email}
                </span>
                <a
                  class={clsx(buttonVariants({ variant: "link" }), "!p-0")}
                  target="_blank"
                  href={
                    userAuthProviderUrl(
                      user().provider.variant,
                      user().provider.remoteId,
                      user().providerResourceId
                    )!
                  }
                >
                  {AUTH_PROVIDER_DISPLAY[user().provider.variant]}
                  <IconPrimeExternalLink class="inline ml-1" />
                </a>
              </div>

              <InviteUserDialog id={user().id} email={user().email}>
                <As component={Button}>Invite</As>
              </InviteUserDialog>
            </div>
          </div>
        )}
      </Show>
    </Show>
  );
}

function InviteUserDialog(props: ParentProps<{ id: string; email: string }>) {
  const [open, setOpen] = createSignal(false);

  const tenant = useTenantContext();
  const mutation = trpc.user.invite.useMutation();

  const form = createZodForm({
    schema: z.object({ message: z.string().email().optional() }),
    onSubmit: async ({ value }) => {
      await mutation.mutateAsync({
        id: props.id,
        message: value.message,
        tenantId: tenant.activeTenant.id,
      });
      setOpen(false);
    },
  });

  return (
    <DialogRoot
      open={open()}
      setOpen={(o) => {
        if (o) form.setFieldValue("email", "");
        setOpen(o);
      }}
    >
      <DialogTrigger asChild>{props.children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite User</DialogTitle>
          <DialogDescription>
            We will send an email to <b>{props.email}</b> with instructions on
            how to enroll their device in this tenant.
          </DialogDescription>
        </DialogHeader>
        <Form form={form} fieldsetClass="space-y-2">
          {/* TODO: Show this as optional + make it a text area */}
          <InputField
            form={form}
            type="text"
            name="message"
            placeholder="Your message"
            autocomplete="off"
          />
          <Button type="submit" class="w-full">
            Send Invitation
          </Button>
        </Form>
      </DialogContent>
    </DialogRoot>
  );
}
