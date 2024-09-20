import {
	BreadcrumbItem,
	Button,
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
	Separator,
} from "@mattrax/ui";
import { Form, InputField, createForm } from "@mattrax/ui/forms";
import { useNavigate } from "@solidjs/router";
import { startTransition } from "solid-js";
import { z } from "zod";
import { useTenant, useTenantId } from "~/app/(dash)";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { Page } from "~/components/Page";
import { trpc } from "~/lib";

export default function () {
	const tenantId = useTenantId();
	const tenant = useTenant();
	const navigate = useNavigate();
	const ctx = trpc.useContext();

	const tenantSettings = trpc.tenant.settings.get.createQuery(() => ({
		tenantId: tenantId(),
	}));

	const updateTenant = trpc.tenant.update.createMutation(() => ({
		// TODO: dependant queries
		onSuccess: () =>
			Promise.all([
				ctx.tenant.list.invalidate(),
				ctx.tenant.settings.get.invalidate(),
			]),
	}));
	const deleteTenant = trpc.tenant.delete.createMutation(() => ({
		onSuccess: () => startTransition(() => navigate("/")),
	}));

	const form = createForm({
		schema: () =>
			z.object({
				name: z
					.string()
					.min(1)
					.max(255)
					.default(tenant()?.name || ""),
				billingEmail: z
					.string()
					.email()
					.min(1)
					.max(255)
					.default(tenantSettings.data?.billingEmail || ""),
			}),
		onSubmit: (data) =>
			updateTenant.mutateAsync({
				tenantId: tenantId(),
				...data,
			}),
	});

	return (
		<Page
			title="Tenant"
			breadcrumbs={[<BreadcrumbItem>Settings</BreadcrumbItem>]}
			class="max-w-4xl flex flex-col space-y-6"
		>
			<div class="flex flex-col space-y-8 lg:flex-row lg:space-x-12 lg:space-y-0 h-screen">
				{/* <aside class="flex space-x-2 lg:flex-col lg:space-x-0 lg:space-y-1 w-full max-w-40 pr-2 border-r-2 h-full">
					<For each={sidebar}>
						{(item) => (
							<A
								end
								href={item.href}
								class={clsx(
									buttonVariants({ variant: "ghost" }),
									"!justify-start",
								)}
								activeClass="bg-muted hover:bg-muted"
								inactiveClass="hover:bg-transparent hover:underline"
							>
								{item.name}
							</A>
						)}
					</For>
				</aside> */}
				<div class="flex-1 lg:max-w-2xl">
					<div class="space-y-6">
						<div>
							<h3 class="text-lg font-medium">Tenant settings</h3>
							<p class="text-sm text-muted-foreground">
								Manage your tenant's general configuration
							</p>
						</div>
						<Separator />

						<Form form={form} fieldsetClass="flex flex-col space-y-6">
							<InputField form={form} name="name" label="Name" />
							<InputField
								form={form}
								name="billingEmail"
								label="Billing Email"
							/>
						</Form>
					</div>

					<div class="space-y-6 pt-4">
						<div>
							<h3 class="text-lg font-medium">Billing</h3>
							<p class="text-sm text-muted-foreground">
								Manage your Mattrax plan and monitor usage
							</p>
						</div>
						<Separator />

						<p class="text-sm text-zinc-500 dark:text-zinc-400">Coming soon</p>
					</div>

					<div class="space-y-6 pt-4">
						<div>
							<h3 class="text-lg font-medium">Danger zone</h3>
							<p class="text-sm text-muted-foreground">TODO: Something smart</p>
						</div>
						<Separator />

						<ConfirmDialog>
							{(confirm) => (
								<Button
									variant="destructive"
									disabled={!tenant()}
									onClick={() =>
										confirm({
											title: "Delete tenant?",
											description: () => (
												<>
													This will delete all of your tenant data, including
													all devices and blueprints!{" "}
													<span class="text-red-500">
														Please be careful as this action is not reversible!
													</span>
													<br />
													<br />
													{/* // TODO: Remove this once the backend is implemented properly */}
													Be aware it can take up to 24 hours for your tenant to
													be fully deleted. It will continue to show up in the
													UI for that time.
												</>
											),
											action: "Delete",
											closeButton: null,
											inputText: tenant()?.name,
											onConfirm: async () =>
												deleteTenant.mutateAsync({
													tenantId: tenantId(),
												}),
										})
									}
								>
									Delete
								</Button>
							)}
						</ConfirmDialog>
					</div>
				</div>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Tenant settings</CardTitle>
					<CardDescription>
						Manage your tenant's general configuration
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Form form={form} fieldsetClass="flex flex-col space-y-6">
						<InputField form={form} name="name" label="Name" />
						<InputField form={form} name="billingEmail" label="Billing Email" />
					</Form>
				</CardContent>
				<CardFooter class="!px-6 !py-3 border-t">
					<Button
						disabled={form.isSubmitting || !form.isValid}
						onClick={() => form.onSubmit()}
					>
						Save
					</Button>
				</CardFooter>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Billing</CardTitle>
					<CardDescription>
						Manage your Mattrax plan and monitor usage
					</CardDescription>
				</CardHeader>
				<CardContent>
					<p class="text-sm text-zinc-500 dark:text-zinc-400">Coming soon</p>
				</CardContent>
			</Card>

			<Card class="!border-red-200">
				<CardHeader>
					<CardTitle>Delete tenant</CardTitle>
					<CardDescription>
						Permanently remove your tenant and all related data! This action is
						not reversible, so please take care.
					</CardDescription>
				</CardHeader>
				<CardFooter class="flex items-center justify-center !px-6 !py-3 rounded-b-xl !bg-red-100/50">
					<div class="flex-1" />
					<ConfirmDialog>
						{(confirm) => (
							<Button
								variant="destructive"
								disabled={!tenant()}
								onClick={() =>
									confirm({
										title: "Delete tenant?",
										description: () => (
											<>
												This will delete all of your tenant data, including all
												devices and blueprints!{" "}
												<span class="text-red-500">
													Please be careful as this action is not reversible!
												</span>
												<br />
												<br />
												{/* // TODO: Remove this once the backend is implemented properly */}
												Be aware it can take up to 24 hours for your tenant to
												be fully deleted. It will continue to show up in the UI
												for that time.
											</>
										),
										action: "Delete",
										closeButton: null,
										inputText: tenant()?.name,
										onConfirm: async () =>
											deleteTenant.mutateAsync({
												tenantId: tenantId(),
											}),
									})
								}
							>
								Delete
							</Button>
						)}
					</ConfirmDialog>
				</CardFooter>
			</Card>
		</Page>
	);
}
