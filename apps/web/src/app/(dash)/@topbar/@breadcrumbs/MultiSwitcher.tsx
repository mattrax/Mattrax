import { withDependantQueries } from "@mattrax/trpc-server-function/client";
import { Popover, PopoverContent, PopoverTrigger } from "@mattrax/ui";
import {
	For,
	type ParentProps,
	Show,
	Suspense,
	createEffect,
	createSignal,
	startTransition,
} from "solid-js";
import { z } from "zod";

import { useZodParams } from "~/lib/useZodParams";

export function MultiSwitcher() {
	const [modal, setModal] = createSignal<"org" | "tenant">();

	const params = useZodParams({
		orgSlug: z.string(),
		tenantSlug: z.string().optional(),
	});

	const [open, setOpen] = createSignal(false);

	const [selectedOrg, setSelectedOrg] = createSignal<
		{ type: "org"; slug: string; id: string } | "create"
	>();

	const query = trpc.org.list.createQuery();
	const orgs = useCachedQueryData(query, () => cachedOrgs());

	const [selectedTenant, setSelectedTenant] = createSignal<
		string | null | undefined
	>();

	createEffect(() => {
		const firstOrg = orgs()?.[0];
		if (selectedOrg() || !firstOrg) return;
		setSelectedOrg({
			type: "org",
			slug: firstOrg.slug,
			id: firstOrg.id,
		});
	});

	const thisOrg = () => orgs()?.find((o) => o.slug === params.orgSlug);

	return (
		<>
			<Show
				when={(() => {
					const o = selectedOrg();
					return typeof o === "object" && o;
				})()}
			>
				{(o) => (
					<CreateTenantDialog
						open={modal() === "tenant"}
						setOpen={(o) => {
							if (!o) setModal(undefined);
						}}
						orgSlug={o().slug}
					/>
				)}
			</Show>
			<CreateOrgDialog
				open={modal() === "org"}
				setOpen={(o) => {
					if (!o) setModal(undefined);
				}}
			/>
			<Popover
				open={open()}
				setOpen={(o) => {
					if (o) {
						const thisO = thisOrg();
						if (thisO) setSelectedOrg({ type: "org", ...thisO });

						setSelectedTenant(params.tenantSlug);
					}
					setOpen(o);
				}}
			>
				<PopoverTrigger as={Button} variant="ghost" size="iconSmall">
					<IconPhCaretUpDown class="h-5 w-5 -mx-1" />
				</PopoverTrigger>
				<PopoverContent class="flex flex-row divide-x divide-gray-300 text-sm max-h-80 overflow-hidden">
					<div class="w-[12rem] flex flex-col overflow-y-auto">
						{/* <div class="p-1 border-b">
            <input
              type="text"
              class="outline-none m-2"
              placeholder="Find Organisation..."
            />
          </div> */}
						<div class="text-xs text-gray-600 px-3 pt-5">Organisations</div>
						<ul class="p-1 pt-2 flex flex-col">
							<For each={orgs()}>
								{(org) => (
									<li
										onClick={() => setOpen(false)}
										onKeyDown={() => setOpen(false)}
									>
										<a
											class={clsx(
												"block px-2 py-1.5 text-sm rounded flex flex-row justify-between items-center focus:outline-none",
												(() => {
													const selOrg = selectedOrg();
													if (
														typeof selOrg === "object" &&
														selOrg.slug === org.slug
													)
														return "bg-neutral-200";
												})(),
											)}
											onMouseEnter={() =>
												setSelectedOrg({
													type: "org",
													slug: org.slug,
													id: org.id,
												})
											}
											href={`/o/${org.slug}`}
										>
											{org.name}
											{org.slug === params.orgSlug && <IconPhCheck />}
										</a>
									</li>
								)}
							</For>
							<li>
								<button
									class={clsx(
										"flex flex-row items-center gap-1 px-2 py-1.5 text-sm rounded w-full",
										selectedOrg() === "create" && "bg-neutral-200",
									)}
									onMouseEnter={() => setSelectedOrg("create")}
									onClick={() => setModal("org")}
									type="button"
								>
									<IconPhPlusCircle />
									Create Organisation
								</button>
							</li>
						</ul>
					</div>
					<div class="w-[12rem] flex flex-col overflow-y-auto">
						<Show
							when={(() => {
								const o = selectedOrg();
								if (typeof o === "object") return o;
							})()}
							keyed
						>
							{(org) => {
								const query = trpc.tenant.list.createQuery(() => ({
									orgSlug: org.slug,
								}));

								createQueryCacher(query, "tenants", (tenant) => ({
									id: tenant.id,
									name: tenant.name,
									slug: tenant.slug,
									orgId: org.id,
								}));

								const tenants = useCachedQueryData(query, () =>
									cachedTenantsForOrg(org.id),
								);

								return (
									<>
										<div class="text-xs text-gray-600 px-3 pt-5">Tenants</div>
										<Suspense>
											<ul class="p-1 pt-2 flex flex-col">
												<For each={tenants()}>
													{(tenant) => (
														<li
															onClick={() => setOpen(false)}
															onKeyDown={() => setOpen(false)}
														>
															<a
																class={clsx(
																	"block px-2 py-1.5 text-sm rounded flex flex-row justify-between items-center focus:outline-none",
																	selectedTenant() === tenant.slug &&
																		"bg-neutral-200",
																)}
																href={`/o/${org.slug}/t/${tenant.slug}`}
																onMouseOver={() =>
																	setSelectedTenant(tenant.slug)
																}
																onFocus={() => setSelectedTenant(tenant.slug)}
															>
																{tenant.name}
																{tenant.slug === params.tenantSlug && (
																	<IconPhCheck />
																)}
															</a>
														</li>
													)}
												</For>
												<li>
													<button
														class={clsx(
															"flex flex-row items-center gap-1 px-2 py-1.5 text-sm rounded w-full",
															selectedTenant() === null && "bg-neutral-200",
														)}
														onMouseEnter={() => setSelectedTenant(null)}
														onClick={() => setModal("tenant")}
														type="button"
													>
														<IconPhPlusCircle />
														Create Tenant
													</button>
												</li>
											</ul>
										</Suspense>
									</>
								);
							}}
						</Show>
					</div>
				</PopoverContent>
			</Popover>
		</>
	);
}

import {
	Button,
	DialogContent,
	DialogHeader,
	DialogRoot,
	DialogTitle,
} from "@mattrax/ui";
import { Form, InputField, createZodForm } from "@mattrax/ui/forms";
import { useNavigate } from "@solidjs/router";
import clsx from "clsx";
import { createQueryCacher, useCachedQueryData } from "~/cache";
import { trpc } from "~/lib";
import { cachedTenantsForOrg } from "~[orgSlug]/utils";
import { cachedOrgs } from "~dash/utils";

export function CreateTenantDialog(props: {
	open: boolean;
	setOpen: (o: boolean) => void;
	orgSlug: string;
}) {
	const navigate = useNavigate();
	const tenants = trpc.tenant.list.createQuery(
		() => ({
			orgSlug: props.orgSlug,
		}),
		() => ({ enabled: false }),
	);

	const mutation = trpc.tenant.create.createMutation(() => ({
		onSuccess: async (slug, { orgSlug }) => {
			// Session also holds tenants
			// await props.refetchSession();
			await startTransition(async () => {
				navigate(`/o/${orgSlug}/t/${slug}`);
				props.setOpen(false);
			});
		},
		...withDependantQueries(tenants),
	}));

	const form = createZodForm({
		schema: z.object({ name: z.string() }),
		onSubmit: ({ value }) =>
			mutation.mutateAsync({ name: value.name, orgSlug: props.orgSlug }),
	});

	createEffect(() => {
		if (props.open) form.reset();
	});

	return (
		<DialogRoot open={props.open} setOpen={props.setOpen}>
			{/* // TODO: Fix mx-4 only offsetting from the left on mobile Safari */}
			<DialogContent class="w-full max-w-xl mx-4">
				<DialogHeader>
					<DialogTitle>Create Tenant</DialogTitle>
				</DialogHeader>
				<Form form={form} fieldsetClass="flex flex-col space-y-4">
					<InputField
						form={form}
						type="text"
						name="name"
						label="Name"
						placeholder="Acme School Inc"
						autocomplete="off"
					/>
					<Button type="submit">Create</Button>
				</Form>
			</DialogContent>
		</DialogRoot>
	);
}

function CreateOrgDialog(props: {
	open: boolean;
	setOpen: (o: boolean) => void;
}) {
	const navigate = useNavigate();
	const orgs = trpc.org.list.createQuery(void 0, () => ({ enabled: false }));

	const mutation = trpc.org.create.createMutation(() => ({
		onSuccess: async (slug) => {
			await startTransition(() => {
				navigate(`/o/${slug}`);
				props.setOpen(false);
			});
		},
		...withDependantQueries(orgs),
	}));

	const form = createZodForm({
		schema: z.object({ name: z.string() }),
		onSubmit: ({ value }) => mutation.mutateAsync({ name: value.name }),
	});

	createEffect(() => {
		if (props.open) form.reset();
	});

	return (
		<DialogRoot open={props.open} setOpen={props.setOpen}>
			{/* // TODO: Fix mx-4 only offsetting from the left on mobile Safari */}
			<DialogContent class="w-full max-w-xl mx-4">
				<DialogHeader>
					<DialogTitle>Create Organisation</DialogTitle>
				</DialogHeader>
				<Form form={form} fieldsetClass="flex flex-col space-y-4">
					<InputField
						form={form}
						type="text"
						name="name"
						label="Name"
						placeholder="New Organisation"
						autocomplete="off"
					/>
					<Button type="submit">Create</Button>
				</Form>
			</DialogContent>
		</DialogRoot>
	);
}
