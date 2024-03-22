import {
	Button,
	Card,
	CardContent,
	CardHeader,
	CardTitle,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogRoot,
	DialogTitle,
} from "@mattrax/ui";
import { Form, InputField, createZodForm } from "@mattrax/ui/forms";
import { createColumnHelper } from "@tanstack/solid-table";
import { Show, createSignal } from "solid-js";
import { Suspense } from "solid-js";
import { z } from "zod";
import { RouterOutput } from "~/api";
import {
	StandardTable,
	createStandardTable,
	selectCheckboxColumn,
} from "~/components/StandardTable";

import { trpc } from "~/lib";

// export const routes = {
// 	load: () => trpc.useContext().account.apiKeys.list.ensureData(),
// }

const column = createColumnHelper<RouterOutput["apiKey"]["list"][number]>();

const columns = [
	selectCheckboxColumn,
	column.accessor("name", { header: "Name" }),
];

export default function Page() {
	const apiKeys = trpc.apiKey.list.useQuery();

	const table = createStandardTable({
		get data() {
			return apiKeys.data ?? [];
		},
		columns,
	});

	return (
		<div>
			<h1 class="text-2xl font-semibold">API Keys</h1>
			<p class="mt-2 mb-3 text-gray-700 text-sm">
				API Keys allow you to access the Mattrax API, as well as use the{" "}
				<a
					href="https://github.com/mattrax/Mattrax/tree/main/apps/mttx"
					target="_blank"
				>
					<code class="p-1 bg-gray-100 rounded">mttx</code>
				</a>{" "}
				CLI.
			</p>
			<div class="flex flex-col gap-4">
				<CreateAPIKeyCard />
				<Suspense>
					<StandardTable table={table} />
				</Suspense>
			</div>
		</div>
	);
}

function CreateAPIKeyCard() {
	const [dialogState, setDialogState] = createSignal<
		{ open: false } | { open: boolean; apiKey: string }
	>({ open: false });

	const trpcCtx = trpc.useContext();
	const createAPIKey = trpc.apiKey.create.useMutation(() => ({
		onSuccess: async (apiKey) => {
			await trpcCtx.apiKey.list.refetch();
			setDialogState({ open: true, apiKey });
		},
	}));
	const form = createZodForm({
		schema: z.object({ name: z.string() }),
		onSubmit: ({ value }) => createAPIKey.mutateAsync(value),
	});

	return (
		<Card>
			<CardHeader>
				<CardTitle>Create API Key</CardTitle>
			</CardHeader>
			<CardContent>
				<Form
					form={form}
					fieldsetClass="flex flex-row gap-4 items-end"
					class="w-full"
				>
					<InputField
						form={form}
						label="Name"
						name="name"
						fieldClass="flex-1"
						labelClasses="text-muted-foreground"
					/>
					<Button type="submit">Create</Button>
				</Form>
			</CardContent>
			<DialogRoot
				open={dialogState().open}
				onOpenChange={(open) =>
					setDialogState((s) => {
						if (createAPIKey.data) return { open, apiKey: createAPIKey.data };
						else return { open };
					})
				}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>API Key Created</DialogTitle>
						<DialogDescription>
							Your API key has been created. Please copy it now as it will not
							be shown again.
						</DialogDescription>
					</DialogHeader>
					<Show
						when={(() => {
							const s = dialogState();
							return "apiKey" in s && s;
						})()}
					>
						{(state) => (
							<p class="my-4 text-gray-700 mx-auto">
								<code>{state().apiKey}</code>
							</p>
						)}
					</Show>
					<Button
						onClick={() => setDialogState((s) => ({ ...s, open: false }))}
					>
						Close
					</Button>
				</DialogContent>
			</DialogRoot>
		</Card>
	);
}
