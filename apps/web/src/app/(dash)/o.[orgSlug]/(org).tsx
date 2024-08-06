import { Button, Card, CardContent, CardHeader } from "@mattrax/ui";
import { Form, InputField, createZodForm } from "@mattrax/ui/forms";
import {
	A,
	Navigate,
	type RouteDefinition,
	useNavigate,
} from "@solidjs/router";
import {
	For,
	Match,
	Show,
	Suspense,
	Switch,
	createSignal,
	startTransition,
} from "solid-js";
import { z } from "zod";

import { type MattraxCache, type TableData, useCachedQueryData } from "~/cache";
import { PageLayout } from "~/components/PageLayout";
import { trpc } from "~/lib";
import { cachedOrgs } from "../utils";
import { useOrgSlug } from "./ctx";
import { cachedTenantsForOrg } from "./utils";

export const route = {
	load: ({ params }) =>
		trpc.useContext().org.tenants.ensureData({ orgSlug: params.orgSlug! }),
} satisfies RouteDefinition;

export default function Page() {
	const orgSlug = useOrgSlug();

	const tenantsQuery = trpc.org.tenants.createQuery(() => ({
		orgSlug: orgSlug(),
	}));
	const tenants = useCachedQueryData(tenantsQuery, async () => {
		const slug = orgSlug();
		const orgs = await cachedOrgs();
		const org = orgs.find((o) => o.slug === slug);
		if (!org) return [];

		return await cachedTenantsForOrg(org.id);
	});

	const [open, setOpen] = createSignal(true);
	setInterval(() => setOpen(!open()), 5000);

	return (
		<Suspense>
			<Show when={tenants()}>
				{(tenants) => (
					<Switch>
						<Match when={tenants().length < 1}>
							<CreateTenant />
						</Match>
						<Match when={tenants().length === 1 && tenants()[0]!}>
							{(tenant) => (
								<Navigate href={`/o/${orgSlug()}/t/${tenant().slug}`} />
							)}
						</Match>
						<Match when={tenants().length > 1}>
							<PageLayout class="pt-6">
								<TenantList tenants={tenants()} />
							</PageLayout>
						</Match>
					</Switch>
				)}
			</Show>
		</Suspense>
	);
}

function TenantList(props: {
	tenants: Array<TableData<MattraxCache["tenants"]>>;
}) {
	return (
		<>
			<span class="p-1 text-sm text-gray-800 font-semibold">Tenants</span>
			<ul class="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
				<For each={props.tenants}>
					{(tenant) => (
						<li class="w-full text-sm">
							<A
								class="flex flex-col items-start gap-1 block w-full p-4 border border-gray-300 shadow-sm hover:shadow-md rounded-lg transition-shadow"
								href={`t/${tenant.slug}`}
							>
								<span class="hover:underline font-semibold">{tenant.name}</span>
								<span class="hover:underline text-gray-700">{tenant.slug}</span>
							</A>
						</li>
					)}
				</For>
			</ul>
		</>
	);
}

function CreateTenant() {
	const orgSlug = useOrgSlug();
	const createTenant = trpc.tenant.create.createMutation();

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
