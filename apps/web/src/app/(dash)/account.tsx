import { BreadcrumbItem } from "@mattrax/ui";
import { Page } from "~/components/Page";

export default function () {
	return (
		<Page
			title="Account"
			breadcrumbs={[<BreadcrumbItem>Settings</BreadcrumbItem>]}
		>
			TODO
		</Page>
	);
}

// function ManageAccountDialogContent() {
// 	const me = trpc.auth.me.createQuery();

// 	// TODO: Rollback form on failure
// 	// TODO: Optimistic UI?
// 	const updateAccount = trpc.auth.update.createMutation(() => ({
// 		onSuccess: () =>
// 			toast.success("Account updated", {
// 				id: "account-updated",
// 			}),
// 		// ...withDependantQueries(me), // TODO: Implement
// 	}));

// 	// const form = createZodForm(() => ({
// 	// 	schema: z.object({ name: z.string(), email: z.string().email() }),
// 	// 	// TODO: We should use a function for this so it updates from the server data when the fields aren't dirty.
// 	// 	// TODO: Right now this breaks the field focus
// 	// 	defaultValues: {
// 	// 		name: me.data?.name || "",
// 	// 		email: me.data?.email || "",
// 	// 	},
// 	// 	onSubmit: ({ value }) =>
// 	// 		updateAccount.mutateAsync({
// 	// 			name: value.name,
// 	// 		}),
// 	// }));

// 	// const triggerSave = debounce(() => {
// 	// 	// TODO: This should probs use the form but it disabled the field which is annoying AF.
// 	// 	updateAccount.mutateAsync({
// 	// 		name: form.getFieldValue("name"),
// 	// 	});
// 	// }, 500);

// 	return (
// 		<DialogContent>
// 			<DialogHeader>
// 				<DialogTitle>Manage account</DialogTitle>
// 				{/* <DialogDescription>
// 					This action cannot be undone. This will permanently delete your
// 					account and remove your data from our servers.
// 				</DialogDescription> */}

// 				{/* <Input></Input> */}
// 				{/* <InputField
// 						fieldClass="col-span-1"
// 						form={form}
// 						name="name"
// 						label="Name"
// 						onInput={() => triggerSave()}
// 					/> */}

// 				{/* // TODO: Change name */}
// 				{/* // TODO: Change email */}
// 				{/* // TODO: Delete account */}
// 			</DialogHeader>
// 		</DialogContent>
// 	);
// }
