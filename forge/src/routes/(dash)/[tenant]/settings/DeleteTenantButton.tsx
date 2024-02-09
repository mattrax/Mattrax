import { As } from "@kobalte/core";
import { useNavigate } from "@solidjs/router";
import { createSignal } from "solid-js";
import {
  Button,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
  Input,
  useController,
} from "~/components/ui";
import { trpc } from "~/lib";
import { useAuthContext } from "~/routes/(dash)";
import { useTenantContext } from "../../[tenant]";

export function DeleteTenantButton() {
  return (
    <DialogRoot>
      <DialogTrigger asChild>
        <As component={Button} variant="destructive" class="w-full">
          Delete Tenant
        </As>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete tenant?</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete your tenant along with all{" "}
            <b>users</b>, <b>devices</b>, <b>policies</b>, <b>applications</b>{" "}
            and <b>groups</b>?
          </DialogDescription>
        </DialogHeader>

        <Body />
      </DialogContent>
    </DialogRoot>
  );
}

// `DialogContent` is only rendered when open. We split this out so the `activeTenantName` works.
function Body() {
  const auth = useAuthContext();
  const tenantCtx = useTenantContext();
  const controller = useController();
  const navigate = useNavigate();

  const tenantName = tenantCtx.activeTenant.name;

  const [input, setInput] = createSignal<string>();
  const deleteTenant = trpc.tenant.delete.useMutation(() => ({
    onSuccess: async () => {
      // Session also holds tenants
      await auth.meQuery.refetch();

      const nextTenant = auth.me.tenants[0]?.id;
      controller.setOpen(false);
      if (nextTenant) {
        tenantCtx.setTenantId(nextTenant);
      } else {
        navigate(`/`);
      }

      // We ensure the form stays disabled until the animation is done.
      await new Promise((r) => setTimeout(r, 1000));
    },
  }));

  return (
    <>
      <p class="text-muted-foreground text-sm">
        To confirm, type <b>{tenantName}</b> in the box below
      </p>
      <Input
        value={input()}
        onInput={(e) => setInput(e.currentTarget.value)}
        disabled={deleteTenant.isPending}
      />
      <Button
        variant="destructive"
        disabled={deleteTenant.isPending || input() !== tenantName}
        onClick={() => deleteTenant.mutate()}
      >
        Delete "{tenantName}"
      </Button>
    </>
  );
}
