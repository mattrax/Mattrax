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
import { createForm, Form, InputField } from "@mattrax/ui/forms";
import { useNavigate } from "@solidjs/router";
import { startTransition } from "solid-js";
import { z } from "zod";
import { Page } from "~/components/Page";
import { trpc } from "~/lib";

export default function () {
	const navigate = useNavigate();
	const ctx = trpc.useContext();
	const createTenant = trpc.tenant.create.createMutation(() => ({
		onSuccess: async (id) => {
			await ctx.tenant.list.invalidate();
			startTransition(() => navigate(`/t/${id}`));
		},
		onError: (err) => console.error("ERROR", err),
	}));

	const form = createForm({
		schema: () =>
			z.object({
				name: z.string().min(1).max(255),
				billingEmail: z.string().email().min(1).max(255),
			}),
		onSubmit: (data) => createTenant.mutateAsync(data),
	});

	return (
		<Page
			title={null}
			breadcrumbs={[<BreadcrumbItem>Create Tenant</BreadcrumbItem>]}
			class="w-full h-full flex flex-col space-y-6 items-center justify-center"
		>
			<Card class="max-w-md">
				<CardHeader>
					<CardTitle>Create Tenant</CardTitle>
					<CardDescription>
						A tenant represents your organisation and holds all of the devices,
						blueprints, applications and more that you manage.
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
						class="ml-auto"
						disabled={form.isSubmitting || !form.isValid}
						onClick={() => form.onSubmit()}
					>
						Create
					</Button>
				</CardFooter>
			</Card>
		</Page>
	);
}
