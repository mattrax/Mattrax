import {
	BreadcrumbItem,
	Button,
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@mattrax/ui";
import { Form, InputField, createForm } from "@mattrax/ui/forms";
import { z } from "zod";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { Page } from "~/components/Page";
import { trpc } from "~/lib";
import { useAccount } from "~/lib/data";

export default function () {
	const account = useAccount();

	const ctx = trpc.useContext();
	const updateAccount = trpc.auth.update.createMutation(() => ({
		// TODO: dependant queries
		onSuccess: () => ctx.auth.me.invalidate(),
	}));
	const deleteAccount = trpc.auth.delete.createMutation(() => ({
		onSuccess: () => {
			localStorage.clear();
			window.location.assign("/login");
		},
	}));

	const form = createForm({
		schema: () =>
			z.object({
				name: z.string().default(account.data?.name || ""),
				email: z.string().default(account.data?.email || ""),
			}),
		onSubmit: (data) => updateAccount.mutateAsync(data),
	});

	return (
		<Page
			breadcrumbs={[<BreadcrumbItem bold>Account</BreadcrumbItem>]}
			class="p-4 max-w-4xl flex flex-col space-y-6"
		>
			<Card>
				<CardHeader>
					<CardTitle>Account settings</CardTitle>
					<CardDescription>
						Manage your account settings and preferences
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Form form={form} fieldsetClass="flex flex-col space-y-6">
						<InputField form={form} name="name" label="Name" />
						<InputField form={form} name="email" label="Email" disabled />
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

			<Card class="!border-red-200">
				<CardHeader>
					<CardTitle>Delete account</CardTitle>
					<CardDescription>
						Permanently remove your account and all related data! This action is
						not reversible, so please take care.
					</CardDescription>
				</CardHeader>
				<CardFooter class="flex items-center justify-center !px-6 !py-3 rounded-b-xl !bg-red-100/50">
					<div class="flex-1" />
					<ConfirmDialog>
						{(confirm) => (
							<Button
								variant="destructive"
								disabled={account.isLoading}
								onClick={() =>
									confirm({
										title: "Delete account?",
										description: () => (
											<>
												This will delete all of your account data, along with
												any orphaned tenants.{" "}
												<span class="text-red-500">
													Please be careful as this action is not reversible!
												</span>
												<br />
												<br />
												{/* // TODO: Remove this once the backend is implemented properly */}
												Be aware it can take up to 24 hours for your account to
												be fully deleted. Please avoid logging in during this
												time.
											</>
										),
										action: "Delete",
										closeButton: null,
										inputText: account.data?.email,
										onConfirm: async () => deleteAccount.mutateAsync(),
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
