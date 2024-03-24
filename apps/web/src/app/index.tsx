import { Button, Card, CardContent, CardHeader } from "@mattrax/ui";
import { InputField, Form, createZodForm } from "@mattrax/ui/forms";
import { Navigate, useNavigate } from "@solidjs/router";
import { Show, startTransition } from "solid-js";
import { z } from "zod";

import { AuthContext, useAuth } from "~c/AuthContext";
import { trpc } from "~/lib";

export const route = {
	load: () => trpc.useContext().auth.me.ensureData(),
};

export default function Page() {
	const defaultTenant = () => {
		const tenants = useAuth()().tenants;
		if (tenants.length < 1) return;

		return tenants[0];
	};

	return (
		<AuthContext>
			<Show when={defaultTenant()} fallback={<CreateTenant />}>
				{(
					tenant, // If we have an active tenant, send the user to it
				) => <Navigate href={`/o/TODO/t/${tenant().slug}`} />}
			</Show>
		</AuthContext>
	);
}

function CreateTenant() {
	const createTenant = trpc.tenant.create.useMutation();

	const navigate = useNavigate();
	const trpcCtx = trpc.useContext();

	const form = createZodForm({
		schema: z.object({ name: z.string() }),
		async onSubmit(data) {
			const tenantId = await createTenant.mutateAsync(data.value);

			await trpcCtx.auth.me.invalidate();

			// lets the rq cache update -_-
			await new Promise((res) => setTimeout(res, 0));

			await startTransition(() => navigate(tenantId));
		},
	});

	return (
		<div class="flex flex-col justify-center items-center flex-1 w-full">
			<Card class="animate-in fade-in duration-500 slide-in-from-bottom-4">
				<CardHeader>
					<h1 class="text-center text-3xl font-semibold mb-2">
						Create a Tenant
					</h1>
					<p class="text-gray-600 mb-4">
						To get started using Mattrax, first create a tenant
					</p>
				</CardHeader>
				<CardContent>
					<Form form={form} class="w-full">
						<div class="flex flex-col items-stretch">
							<div class="animate-in fade-in duration-700 slide-in-from-bottom-4">
								<InputField autofocus form={form} label="Name" name="name" />
								<Button class="w-full mt-2" type="submit">
									Create
								</Button>
							</div>
						</div>
					</Form>
				</CardContent>
			</Card>
		</div>
	);
}
