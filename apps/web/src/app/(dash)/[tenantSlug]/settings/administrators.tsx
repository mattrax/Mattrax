import type { RouteDefinition } from "@solidjs/router";
import { For, Suspense } from "solid-js";
import { z } from "zod";

import { ConfirmDialog } from "~/components/ConfirmDialog";
import { Form, InputField, createZodForm } from "@mattrax/ui/forms";
import {
	Badge,
	Button,
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@mattrax/ui";
import { trpc } from "~/lib";
import { useAuth } from "~/app/AuthContext";
import { useTenant } from "../../TenantContext";
import { useTenantSlug } from "../../[tenantSlug]";

export const route = {
	load: ({ params }) => {
		trpc.useContext().tenant.admins.list.ensureData({
			tenantSlug: params.tenantSlug!,
		});
	},
} satisfies RouteDefinition;

export default function Page() {
	const auth = useAuth();
	const tenant = useTenant();

	const invites = trpc.tenant.admins.invites.useQuery(() => ({
		tenantSlug: tenant().slug,
	}));

	const administrators = trpc.tenant.admins.list.useQuery(() => ({
		tenantSlug: tenant().slug,
	}));

	const removeInvite = trpc.tenant.admins.removeInvite.useMutation(() => ({
		onSuccess: () => invites.refetch(),
	}));
	const removeAdmin = trpc.tenant.admins.remove.useMutation(() => ({
		onSuccess: () => administrators.refetch(),
	}));

	return (
		<div>
			<h1 class="text-2xl font-semibold">Administrators</h1>
			<p class="mt-2 mb-3 text-gray-700 text-sm">
				Control who is allowed to manage this tenant.
			</p>
			<div class="flex flex-col gap-4">
				<InviteAdminCard />
				<Suspense>
					<ConfirmDialog>
						{(confirm) => (
							<ul class="rounded border border-gray-200 divide-y divide-gray-200">
								<For each={invites.data}>
									{(invite) => (
										<li class="p-4 flex flex-row justify-between">
											<div class="flex-1 flex flex-row space-x-4 items-center">
												<div class="flex flex-col text-sm">
													<span class="font-semibold text-yellow-700">
														Pending Invitation
													</span>
													<span class="text-gray-500">{invite.email}</span>
												</div>
											</div>
											<div>
												{auth().id === tenant().ownerId && (
													<Button
														variant="destructive"
														size="sm"
														onClick={() => {
															confirm({
																title: "Remove Invite",
																description: (
																	<>
																		Are you sure you want to remove the invite
																		for <b>{invite.email}</b>?
																	</>
																),
																action: "Remove",
																onConfirm: async () =>
																	await removeInvite.mutateAsync({
																		tenantSlug: tenant().slug,
																		email: invite.email,
																	}),
															});
														}}
													>
														Remove
													</Button>
												)}
											</div>
										</li>
									)}
								</For>
								<For each={administrators.data}>
									{(admin) => (
										<li class="p-4 flex flex-row justify-between">
											<div class="flex-1 flex flex-row space-x-4 items-center">
												<div class="flex flex-col text-sm">
													<span class="font-semibold">{admin.name}</span>
													<span class="text-gray-500">{admin.email}</span>
												</div>
												{admin.isOwner && (
													<div>
														<Badge>Owner</Badge>
													</div>
												)}
											</div>
											<div>
												{auth().id === tenant().ownerId && !admin.isOwner && (
													<Button
														variant="destructive"
														size="sm"
														onClick={() => {
															confirm({
																title: "Remove Administrator",
																description: (
																	<>
																		Are you sure you want to remove{" "}
																		<b>{admin.email}</b> from this tenant's
																		administrators?
																	</>
																),
																action: "Remove",
																onConfirm: async () =>
																	await removeAdmin.mutateAsync({
																		tenantSlug: tenant().slug,
																		adminId: admin.id,
																	}),
															});
														}}
													>
														Remove
													</Button>
												)}
											</div>
										</li>
									)}
								</For>
							</ul>
						)}
					</ConfirmDialog>
				</Suspense>
			</div>
		</div>
	);
}

function InviteAdminCard() {
	const tenantSlug = useTenantSlug();
	const trpcCtx = trpc.useContext();

	const inviteAdmin = trpc.tenant.admins.sendInvite.useMutation(() => ({
		onSuccess: async () => {
			await Promise.allSettled([
				trpcCtx.tenant.admins.invites.refetch(),
				trpcCtx.tenant.admins.list.refetch(),
			]);
			form.setFieldValue("email", "");
		},
	}));

	const form = createZodForm({
		schema: z.object({ email: z.string().email() }),
		onSubmit: ({ value }) =>
			inviteAdmin.mutateAsync({
				email: value.email,
				tenantSlug: tenantSlug(),
			}),
	});

	return (
		<Card>
			<CardHeader>
				<CardTitle>Invite Administrator</CardTitle>
				<CardDescription>
					Invite a new administrator to this tenant. They will receive an
					invitation email and be granted full administrative access to this
					tenant.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<Form form={form} fieldsetClass="flex flex-row gap-4" class="w-full">
					<InputField
						form={form}
						name="email"
						fieldClass="flex-1"
						placeholder="oscar@example.com"
						labelClasses="text-muted-foreground"
					/>
					<Button type="submit">Invite</Button>
				</Form>
			</CardContent>
		</Card>
	);
}
