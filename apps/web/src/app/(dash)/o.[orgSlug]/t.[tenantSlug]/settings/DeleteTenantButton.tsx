import { useNavigate } from "@solidjs/router";
import { startTransition } from "solid-js";

import { Button } from "@mattrax/ui";
import { trpc } from "~/lib";
import { ConfirmDialog } from "~c/ConfirmDialog";
import { useTenant } from "../Context";
import { useOrgSlug } from "~/app/(dash)/o.[orgSlug]";
import { withDependantQueries } from "@mattrax/trpc-server-function/client";

export function DeleteTenantButton() {
	const orgSlug = useOrgSlug();
	const tenants = trpc.tenant.list.createQuery(
		() => ({
			orgSlug: orgSlug(),
		}),
		() => ({
			enabled: false,
		}),
	);

	const deleteTenant = trpc.tenant.delete.createMutation(() => ({
		onSuccess() {},
		...withDependantQueries(tenants, {
			blockOn: true,
		}),
	}));
	const navigate = useNavigate();
	const tenant = useTenant();

	return (
		<ConfirmDialog>
			{(confirm) => (
				<Button
					variant="destructive"
					onClick={() =>
						confirm({
							title: "Delete tenant?",
							action: `Delete '${tenant().name}'`,
							description: () => (
								<>
									Are you sure you want to delete your tenant along with all{" "}
									<b>users</b>, <b>devices</b>, <b>policies</b>,{" "}
									<b>applications</b> and <b>groups</b>?
								</>
							),
							inputText: tenant().name,
							async onConfirm() {
								await deleteTenant.mutateAsync({
									tenantSlug: tenant().slug,
								});

								await startTransition(() => navigate(`/o/${orgSlug()}`));
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
