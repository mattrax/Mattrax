import type { RouteDefinition } from "@solidjs/router";
import { For, Suspense } from "solid-js";
import { z } from "zod";

import { withDependantQueries } from "@mattrax/trpc-server-function/client";
import {
	Badge,
	Button,
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@mattrax/ui";
import { Form, InputField, createZodForm } from "@mattrax/ui/forms";
import { trpc } from "~/lib";
import { ConfirmDialog } from "~c/ConfirmDialog";
import { useAuth } from "../../utils";
import { useOrg, useOrgSlug } from "../ctx";

export const route = {
	load: ({ params }) => {
		trpc.useContext().org.admins.list.ensureData({
			orgSlug: params.orgSlug!,
		});
	},
} satisfies RouteDefinition;

export default function Page() {
	const orgSlug = useOrgSlug();

	const invites = trpc.org.admins.invites.createQuery(() => ({
		orgSlug: orgSlug(),
	}));

	const administrators = trpc.org.admins.list.createQuery(() => ({
		orgSlug: orgSlug(),
	}));

	const removeInvite = trpc.org.admins.removeInvite.createMutation(() => ({
		...withDependantQueries(invites),
	}));
	const removeAdmin = trpc.org.admins.remove.createMutation(() => ({
		...withDependantQueries(administrators),
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
						{(confirm) => {
							const account = useAuth();
							const org = useOrg();

							return (
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
													{account.data?.id === org()?.ownerId && (
														<Button
															variant="destructive"
															size="sm"
															onClick={() => {
																confirm({
																	title: "Remove Invite",
																	description: () => (
																		<>
																			Are you sure you want to remove the invite
																			for <b>{invite.email}</b>?
																		</>
																	),
																	action: "Remove",
																	onConfirm: async () =>
																		await removeInvite.mutateAsync({
																			orgSlug: orgSlug(),
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
													{account.data?.id === org()?.ownerId &&
														!admin.isOwner && (
															<Button
																variant="destructive"
																size="sm"
																disabled={org.query.isPending}
																onClick={() => {
																	confirm({
																		title: "Remove Administrator",
																		description: () => (
																			<>
																				Are you sure you want to remove{" "}
																				<b>{admin.email}</b> from this tenant's
																				administrators?
																			</>
																		),
																		action: "Remove",
																		onConfirm: async () =>
																			await removeAdmin.mutateAsync({
																				orgSlug: org()!.slug,
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
							);
						}}
					</ConfirmDialog>
				</Suspense>
			</div>
		</div>
	);
}

function InviteAdminCard() {
	const orgSlug = useOrgSlug();
	const invites = trpc.org.admins.invites.createQuery(
		() => ({
			orgSlug: orgSlug(),
		}),
		() => ({ enabled: false }),
	);
	const admins = trpc.org.admins.list.createQuery(
		() => ({
			orgSlug: orgSlug(),
		}),
		() => ({ enabled: false }),
	);

	const inviteAdmin = trpc.org.admins.sendInvite.createMutation(() => ({
		...withDependantQueries([invites, admins]),
	}));

	const form = createZodForm(() => ({
		schema: z.object({ email: z.string().email() }),
		onSubmit: async ({ value }) => {
			await inviteAdmin.mutateAsync({
				email: value.email,
				orgSlug: orgSlug(),
			});
			form.setFieldValue("email", "");
		},
	}));

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
