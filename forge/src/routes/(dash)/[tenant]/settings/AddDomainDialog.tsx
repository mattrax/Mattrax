import { ParentProps, createSignal } from "solid-js";
import { z } from "zod";

import { Form, InputField, createZodForm } from "~/components/forms";
import {
  Button,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui";
import { trpc } from "~/lib";

export function AddDomainDialog(props: ParentProps) {
  const [open, setOpen] = createSignal(false);

  const createDomain = trpc.tenant.domains.create.useMutation();
  const trpcCtx = trpc.useContext();

  const form = createZodForm({
    schema: z.object({
      domain: z.string(),
    }),
    async onSubmit({ value }) {
      await createDomain.mutateAsync(value);
      await trpcCtx.tenant.domains.list.refetch();
      setOpen(false);
    },
  });

  return (
    <DialogRoot open={open()} setOpen={setOpen}>
      <DialogTrigger asChild>{props.children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Domain</DialogTitle>
        </DialogHeader>
        <Form form={form}>
          <InputField form={form} name="domain" label="Domain" />
          <DialogFooter class="mt-4">
            <Button type="submit">Add Domain</Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </DialogRoot>
  );
}
