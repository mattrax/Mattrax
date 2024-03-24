import { For, Show, Suspense, startTransition } from "solid-js";
import { Button, Card, CardContent, CardHeader } from "@mattrax/ui";
import { InputField, Form, createZodForm } from "@mattrax/ui/forms";
import { A, useNavigate } from "@solidjs/router";
import { z } from "zod";

import { trpc } from "~/lib";
import { useOrgSlug } from "../o.[orgSlug]";
import { PageLayout } from "~/components/PageLayout";

export default function Page() {
	const orgSlug = useOrgSlug();
	const tenants = trpc.org.tenants.useQuery(() => ({ orgSlug: orgSlug() }));

	return (
		<Suspense>
			<Show
				when={tenants.data && tenants.data.length > 0}
				fallback={<CreateTenant />}
			>
				<PageLayout class="pt-6">
					<span class="p-1 text-sm text-gray-800 font-semibold">Tenants</span>
					<ul>
						<For each={tenants.data ?? []}>
							{(tenant) => (
								<li class="w-full text-sm">
									<A
										class="flex flex-col items-stretch gap-1 block w-full p-4 border border-gray-300 shadow rounded-lg"
										href={`t/${tenant.slug}`}
									>
										<span class="hover:underline font-semibold">
											{tenant.name}
										</span>
										<span class="hover:underline text-gray-700">
											{tenant.slug}
										</span>
									</A>
								</li>
							)}
						</For>
					</ul>
				</PageLayout>
			</Show>
		</Suspense>
	);
}

function CreateTenant() {
	const orgSlug = useOrgSlug();
	const createTenant = trpc.tenant.create.useMutation();

	const navigate = useNavigate();
	const trpcCtx = trpc.useContext();

	const form = createZodForm({
		schema: z.object({ name: z.string() }),
		async onSubmit(data) {
			const tenantId = await createTenant.mutateAsync({
				...data.value,
				orgSlug: orgSlug(),
			});

			await trpcCtx.auth.me.invalidate();

			// lets the rq cache update -_-
			await new Promise((res) => setTimeout(res, 0));

			await startTransition(() => navigate(`t/${tenantId}`));
		},
	});

	return (
		<div class="flex flex-col justify-center items-center flex-1 w-full">
			<Card>
				<CardHeader>
					<h1 class="text-center text-3xl font-semibold mb-1">
						Welcome to Mattrax
					</h1>
					<p class="text-gray-600 mb-4 mx-auto">
						Create a tenant to get started
					</p>
				</CardHeader>
				<CardContent>
					<Form form={form} class="w-full">
						<div class="flex flex-col items-stretch">
							<InputField autofocus form={form} label="Name" name="name" />
							<Button class="w-full mt-2" type="submit">
								Create
							</Button>
						</div>
					</Form>
				</CardContent>
			</Card>
		</div>
	);
}
