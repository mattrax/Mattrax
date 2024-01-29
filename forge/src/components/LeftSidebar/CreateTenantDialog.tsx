// TODO: Use form abstraction
// TODO: Proper loading state during POST and GET
// TODO: Invalidate data

import { client } from "~/lib";
import {
  Button,
  DialogHeader,
  DialogTitle,
  Input,
  useController,
} from "~/components/ui";

export function CreateTenantDialog(props: {
  refetchSession: () => Promise<void>;
  setActiveTenant: (id: string) => void;
}) {
  const dialog = useController();

  return (
    <>
      <DialogHeader>
        <DialogTitle>Create tenant</DialogTitle>
      </DialogHeader>
      <form
        class="flex flex-col space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const formData = new FormData(e.currentTarget);
          client.api.tenants.create
            .$post({
              json: {
                name: formData.get("name") as any,
              },
            })
            .then(async (resp) => {
              // TODO: Proper error handling
              if (!resp.ok) {
                console.error("Error creating tenant", resp);
                return;
              }

              const data = await resp.json();

              // TODO: Get the data back in the response instead of a separate request
              // Session also holds tenants
              props.refetchSession().then(() => {
                props.setActiveTenant(data.id);
                dialog.setOpen(false);
              });
            });
        }}
        method="post"
      >
        <Input type="text" name="name" placeholder="Acme School Inc" />
        <Button type="submit">Create</Button>
      </form>
    </>
  );
}
