import { useNavigate } from "@solidjs/router";
import { startTransition } from "solid-js";

import { ConfirmDialog } from "~/components/ConfirmDialog";
import { Button } from "~/components/ui";
import { trpc } from "~/lib";
import { useAuthContext } from "~/app/(dash)";
import { useTenantContext } from "../../[tenant]";

export function DeleteTenantButton() {
  const deleteTenant = trpc.tenant.delete.useMutation();
  const auth = useAuthContext();
  const navigate = useNavigate();
  const tenantCtx = useTenantContext();

  return (
    <ConfirmDialog>
      {(confirm) => (
        <Button
          variant="destructive"
          onClick={() =>
            confirm({
              title: "Delete tenant?",
              action: `Delete '${tenantCtx.activeTenant.name}'`,
              description: (
                <>
                  Are you sure you want to delete your tenant along with all{" "}
                  <b>users</b>, <b>devices</b>, <b>policies</b>,{" "}
                  <b>applications</b> and <b>groups</b>?
                </>
              ),
              inputText: tenantCtx.activeTenant.name,
              async onConfirm() {
                await deleteTenant.mutateAsync();
                await auth.meQuery.refetch();

                await startTransition(() => navigate("/"));
              },
            })
          }
        >
          Delete Tenant
        </Button>
      )}
    </ConfirmDialog>
  );
}
