import {
  Button,
  DialogHeader,
  DialogTitle,
  Input,
  useController,
} from "~/components/ui";
import { trpc } from "~/lib";

// TODO: Use form abstraction

export function CreateTenantDialog(props: {
  refetchSession: () => Promise<void>;
  setActiveTenant: (id: string) => void;
}) {
  const dialog = useController();
  const mutation = trpc.tenant.create.useMutation(() => ({
    onSuccess: async (tenantId) => {
      // TODO: Get the data back in the response instead of a separate request
      // Session also holds tenants
      await props.refetchSession();
      props.setActiveTenant(tenantId);
      dialog.setOpen(false);

      // Ensure the form stays disabled until the dialog is closed
      await new Promise((resolve) => setTimeout(resolve, 1000));
    },
  }));

  return (
    <>
      <DialogHeader>
        <DialogTitle>Create tenant</DialogTitle>
      </DialogHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const formData = new FormData(e.currentTarget);
          mutation.mutate({
            name: formData.get("name") as any,
          });
        }}
      >
        <fieldset class="flex flex-col space-y-4" disabled={mutation.isPending}>
          <Input
            type="text"
            name="name"
            placeholder="Acme School Inc"
            autocomplete="off"
          />
          <Button type="submit">Create</Button>
        </fieldset>
      </form>
    </>
  );
}
