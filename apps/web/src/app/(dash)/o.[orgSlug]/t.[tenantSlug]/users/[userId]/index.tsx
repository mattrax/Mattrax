import { type ParentProps, Show, createSignal, For, Suspense } from "solid-js";
import { Form, InputField, createZodForm } from "@mattrax/ui/forms";
import { A, RouteDefinition } from "@solidjs/router";
import { As } from "@kobalte/core";
import pluralize from "pluralize";
import clsx from "clsx";
import { z } from "zod";
import {
	Button,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogRoot,
	DialogTitle,
	DialogTrigger,
	Label,
	buttonVariants,
} from "@mattrax/ui";

import IconMaterialSymbolsWarningRounded from "~icons/material-symbols/warning-rounded.jsx";
import IconPrimeExternalLink from "~icons/prime/external-link.jsx";
import { AUTH_PROVIDER_DISPLAY, userAuthProviderUrl } from "~/lib/values";
import { VariantTableSheet, variantTableColumns } from "~c/VariantTableSheet";
import { StandardTable, createStandardTable } from "~/components/StandardTable";
import { useTenantSlug } from "../../../t.[tenantSlug]";
import { BruhIconPhLaptop } from "./bruh";
import { useUser } from "./Context";
import { trpc } from "~/lib";

export const route = {
	load: ({ params }) => {
		trpc.useContext().user.devices.ensureData({ id: params.userId! });
		trpc.useContext().user.assignments.ensureData({ id: params.userId! });
	},
} satisfies RouteDefinition;

export default function Page() {
	const user = useUser();

	return (
		<div class="px-4 py-8 w-full max-w-5xl mx-auto flex flex-col">
			<div class="flex flex-row justify-between">
				<div>
					<h1 class="text-3xl font-bold">{user().name}</h1>
					<span class="block mt-1 text-gray-700 text-sm">{user().email}</span>
				</div>
				<IdPLink />
			</div>
			<hr class="w-full h-px my-4 border-gray-200" />
			<div class="flex flex-row gap-8">
				<div class="flex-1 space-y-4">
					<Devices />
				</div>
				<div class="flex-1 space-y-4">
					<Assignments />
				</div>
			</div>
		</div>
	);
}

function IdPLink() {
	const user = useUser();

	return (
		<Show
			when={user().providerResourceId}
			fallback={
				<span class="flex flex-row items-center text-sm gap-1 font-medium">
					<IconMaterialSymbolsWarningRounded class="w-5 h-5 text-yellow-600" />
					User not found in {AUTH_PROVIDER_DISPLAY[user().provider.variant]}
				</span>
			}
		>
			{(resourceId) => (
				<a
					class={clsx(buttonVariants({ variant: "link" }), "!p-0")}
					target="_blank"
					href={
						userAuthProviderUrl(
							user().provider.variant,
							user().provider.remoteId,
							resourceId(),
						)!
					}
					rel="noreferrer"
				>
					{AUTH_PROVIDER_DISPLAY[user().provider.variant]}
					<IconPrimeExternalLink class="inline ml-1" />
				</a>
			)}
		</Show>
	);
}

function Devices() {
	const user = useUser();
	const devices = trpc.user.devices.createQuery(() => ({
		id: user().id,
	}));

	return (
		<>
			<div class="flex flex-row justify-between items-center">
				<Label>Devices</Label>

				<SendInstructionsDialog id={user().id} email={user().email}>
					<As component={Button} size="sm">
						Send Instructions
					</As>
				</SendInstructionsDialog>
			</div>
			<div class="flex flex-col space-y-2">
				<Suspense>
					<For
						each={devices.data}
						fallback={
							<div class="w-full text-center py-8">
								<p class="text-sm">No Results.</p>
							</div>
						}
					>
						{(device) => (
							<A href={`../../devices/${device.id}`}>
								<div class="flex items-center space-x-2 border rounded-md p-2">
									<span class="text-4xl">
										<BruhIconPhLaptop />
									</span>
									<div>
										<p class="text-xl">{device.name}</p>
										<p class="text-sm text-gray-600">Windows</p>
									</div>
								</div>
							</A>
						)}
					</For>
				</Suspense>
			</div>
		</>
	);
}

function Assignments() {
	const user = useUser();
	const tenantSlug = useTenantSlug();

	const assignments = trpc.user.assignments.createQuery(() => ({
		id: user().id,
	}));

	const table = createStandardTable({
		get data() {
			if (!assignments.data) return [];

			return [
				...assignments.data.policies.map((d) => ({ ...d, variant: "policy" })),
				...assignments.data.apps.map((d) => ({ ...d, variant: "application" })),
			];
		},
		columns: variantTableColumns,
		pagination: true,
	});

	const addAssignments = trpc.user.addAssignments.createMutation(() => ({
		onSuccess: () => assignments.refetch(),
	}));

	const variants = {
		policy: {
			label: "Policies",
			query: trpc.tenant.variantTable.policies.createQuery(() => ({
				tenantSlug: tenantSlug(),
			})),
		},
		application: {
			label: "Applications",
			query: trpc.tenant.variantTable.apps.createQuery(() => ({
				tenantSlug: tenantSlug(),
			})),
		},
	};

	return (
		<>
			<div class="flex flex-row justify-between items-center">
				<Label>Assignments</Label>

				<VariantTableSheet
					title="Add Assignments"
					description="Assign policies and apps to this user."
					getSubmitText={(count) =>
						`Add ${count} ${pluralize("Assignment", count)}`
					}
					variants={variants}
					onSubmit={(assignments) =>
						addAssignments.mutateAsync({
							id: user().id,
							assignments,
						})
					}
				>
					<As component={Button} class="ml-auto" size="sm">
						Add Assignments
					</As>
				</VariantTableSheet>
			</div>

			<Suspense>
				<StandardTable table={table} />
			</Suspense>
		</>
	);
}

function SendInstructionsDialog(
	props: ParentProps<{ id: string; email: string }>,
) {
	const [open, setOpen] = createSignal(false);

	const mutation = trpc.user.invite.createMutation();

	const form = createZodForm({
		schema: z.object({ message: z.string().email().optional() }),
		onSubmit: async ({ value }) => {
			await mutation.mutateAsync({
				id: props.id,
				message: value.message,
			});
			setOpen(false);
		},
	});

	return (
		<DialogRoot
			open={open()}
			setOpen={(o) => {
				if (o) form.setFieldValue("message", "");
				setOpen(o);
			}}
		>
			<DialogTrigger asChild>{props.children}</DialogTrigger>
			<DialogContent class="max-w-md">
				<DialogHeader>
					<DialogTitle>Send Instructions</DialogTitle>
					<DialogDescription>
						We will send an email to <b>{props.email}</b> with instructions on
						how to enroll their device in this tenant.
					</DialogDescription>
				</DialogHeader>
				<Form form={form} fieldsetClass="space-y-2">
					{/* TODO: Show this as optional + make it a text area */}
					<InputField
						form={form}
						type="text"
						name="message"
						placeholder="Your custom message"
						autocomplete="off"
					/>
					<Button type="submit" class="w-full">
						Send Invitation
					</Button>
				</Form>
			</DialogContent>
		</DialogRoot>
	);
}
