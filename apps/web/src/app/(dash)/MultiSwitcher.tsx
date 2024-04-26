import { Popover, PopoverContent, PopoverTrigger } from "@mattrax/ui";
import {
	For,
	type ParentProps,
	createSignal,
	startTransition,
	Show,
	Suspense,
	createEffect,
} from "solid-js";
import { createWritableMemo } from "@solid-primitives/memo";

import { useZodParams } from "~/lib/useZodParams";
import { z } from "zod";

export function MultiSwitcher(props: ParentProps) {
	const [modal, setModal] = createSignal<"org" | "tenant">();

	const params = useZodParams({
		orgSlug: z.string(),
		tenantSlug: z.string().optional(),
	});

	const [open, setOpen] = createSignal(false);

	const [selectedOrg, setSelectedOrg] = createSignal<
		{ type: "org"; slug: string } | "create"
	>({ type: "org", slug: params.orgSlug });

	const orgs = trpc.org.list.createQuery();

	const [selectedTenant, setSelectedTenant] = createWritableMemo<
		string | null | undefined
	>(() => {
		return undefined;
	});

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
						setSelectedOrg({ type: "org", slug: params.orgSlug });
						setSelectedTenant(params.tenantSlug);
					}
					setOpen(o);
				}}
			>
				<PopoverTrigger asChild>{props.children}</PopoverTrigger>
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
						<Suspense>
							<ul class="p-1 pt-2 flex flex-col">
								<For each={orgs.data}>
									{(org) => (
										<li onClick={() => setOpen(false)}>
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
													setSelectedOrg({ type: "org", slug: org.slug })
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
									>
										<IconPhPlusCircle />
										Create Organisation
									</button>
								</li>
							</ul>
						</Suspense>
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
								const tenants = trpc.tenant.list.createQuery(() => ({
									orgSlug: org.slug,
								}));

								return (
									<>
										<div class="text-xs text-gray-600 px-3 pt-5">Tenants</div>
										<Suspense>
											<ul class="p-1 pt-2 flex flex-col">
												<For each={tenants.data}>
													{(tenant) => (
														<li onClick={() => setOpen(false)}>
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

import { Form, InputField, createZodForm } from "@mattrax/ui/forms";
import {
	Button,
	DialogContent,
	DialogHeader,
	DialogRoot,
	DialogTitle,
} from "@mattrax/ui";
import { trpc } from "~/lib";
import { useNavigate } from "@solidjs/router";
import clsx from "clsx";

export function CreateTenantDialog(props: {
	open: boolean;
	setOpen: (o: boolean) => void;
	orgSlug: string;
}) {
	const navigate = useNavigate();
	const trpcCtx = trpc.useContext();

	const mutation = trpc.tenant.create.createMutation(() => ({
		onSuccess: async (slug, { orgSlug }) => {
			// TODO: Get the data back in the response instead of a separate request
			// Session also holds tenants
			// await props.refetchSession();
			await trpcCtx.auth.me.invalidate();
			await startTransition(async () => {
				navigate(`/o/${orgSlug}/t/${slug}`);
				props.setOpen(false);
			});
		},
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
	const trpcCtx = trpc.useContext();

	const mutation = trpc.org.create.createMutation(() => ({
		onSuccess: async (slug) => {
			// TODO: Get the data back in the response instead of a separate request
			// Session also holds tenants
			// await props.refetchSession();
			await trpcCtx.auth.me.invalidate();
			await startTransition(() => {
				navigate(`/o/${slug}`);
				props.setOpen(false);
			});
		},
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
