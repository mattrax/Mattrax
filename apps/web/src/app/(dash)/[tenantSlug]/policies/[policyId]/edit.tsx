import { As } from "@kobalte/core";
import { z } from "zod";

import {
	DialogContent,
	DialogRoot,
	DialogTrigger,
	Textarea,
	Button,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	useController,
	Card,
	CardContent,
	CardHeader,
	CardTitle,
	Input,
} from "@mattrax/ui";
import { PageLayout, PageLayoutHeading } from "../../PageLayout";
import { usePolicy } from "./Context";
import { trpc } from "~/lib";
import { For, Show, Suspense, createSignal } from "solid-js";
import { Form, InputField, createZodForm } from "@mattrax/ui/forms";

export default function Page() {
	const policy = usePolicy();
	const updatePolicy = trpc.policy.update.useMutation(() => ({
		onSuccess: () => policy.query.refetch(),
	}));

	return (
		<PageLayout
			heading={
				<div class="flex justify-between w-full items-center">
					<PageLayoutHeading>Edit</PageLayoutHeading>
					<DeployButton />
				</div>
			}
		>
			<Editor
				data={policy().data}
				updatePolicy={(data) =>
					updatePolicy.mutate({
						policyId: policy().id,
						data,
					})
				}
				disabled={updatePolicy.isPending}
			/>
		</PageLayout>
	);
}

function DeployButton() {
	const policy = usePolicy();
	const trpcCtx = trpc.useContext();

	return (
		<DialogRoot>
			<DialogTrigger asChild>
				<As
					component={Button}
					disabled={!(policy().isDirty ?? true)}
					onMouseEnter={() => {
						trpcCtx.policy.getDeploySummary.ensureData({
							policyId: policy().id,
						});
					}}
				>
					Deploy
				</As>
			</DialogTrigger>
			<DialogContent>
				<DeployDialog />
			</DialogContent>
		</DialogRoot>
	);
}

function DeployDialog() {
	const policy = usePolicy();

	const [page, setPage] = createSignal(0);
	const controller = useController();
	const [comment, setComment] = createSignal("");

	const getDeploySummary = trpc.policy.getDeploySummary.useQuery(() => ({
		policyId: policy().id,
	}));

	const deployVersion = trpc.policy.deploy.useMutation(() => ({
		onSuccess: async () => {
			await policy.query.refetch();
			controller.setOpen(false);
		},
	}));

	return (
		<DialogHeader>
			<DialogTitle>Deploy changes</DialogTitle>
			<DialogDescription>
				Would you like to deploy the following changes to{" "}
				<b>
					<Suspense fallback="...">{getDeploySummary.data?.numScoped}</Suspense>
				</b>{" "}
				entities?
			</DialogDescription>
			{page() === 0 && (
				<>
					<ul class="list-disc pl-4 text-md leading-none tracking-tight text-semibold flex flex-col space-y-2 py-2">
						<Suspense fallback="">
							<For each={Object.entries(getDeploySummary.data?.changes || {})}>
								{([key, value]) => (
									<li>
										<p>{`${key} changed to ${value}`}</p>
									</li>
								)}
							</For>
						</Suspense>
					</ul>
					<Button type="button" onClick={() => setPage(1)}>
						Confirm Changes
					</Button>
				</>
			)}
			{page() === 1 && (
				<>
					<Textarea
						placeholder="Provide some context to your team!"
						value={comment()}
						onChange={(e) => setComment(e.currentTarget.value)}
					/>
					<Button
						variant="destructive"
						onClick={() =>
							deployVersion.mutate({
								policyId: policy().id,
								comment: comment(),
							})
						}
					>
						Deploy to {getDeploySummary.data?.numScoped} entities
					</Button>
				</>
			)}
		</DialogHeader>
	);
}

function Editor(props: {
	data: Record<any, unknown>;
	updatePolicy: (data: Record<any, unknown>) => void;
	disabled?: boolean;
}) {
	const form = createZodForm({
		schema: z.object({
			uri: z.string(),
			value: z.string(),
		}),
		onSubmit: ({ value }) =>
			props.updatePolicy({
				...props.data,
				windows: {
					...(props.data?.windows || {}),
					[value.uri]: value.value,
				},
			}),
	});

	const formState = form.useStore();
	const isDisabled = () => formState().isSubmitting || props.disabled;

	// TODO: Properly reset the form and file input after submission

	return (
		<PageLayout class="pt-4">
			<Card>
				<CardHeader class="flex-row justify-between">
					<div class="flex space-x-2 justify-center items-center">
						<CardTitle>Editor</CardTitle>
					</div>
				</CardHeader>
				<CardContent class="flex flex-col space-y-4">
					<div>
						<h1 class="text-md font-semibold leading-none tracking-tight py-2">
							Windows
						</h1>
						<div class="flex flex-col space-y-3">
							<For each={Object.entries((props.data as any)?.windows || {})}>
								{([uri, value]) => (
									<div class="flex space-x-3">
										<Input
											value={uri}
											class="flex-1"
											disabled={isDisabled() || true}
										/>
										<Input
											value={value as string}
											class="flex-1"
											disabled={isDisabled() || true}
										/>
										<Button
											variant="destructive"
											class="w-16"
											disabled={isDisabled()}
											onClick={() => {
												const windows: Record<any, unknown> = {
													...(props.data?.windows || {}),
												};
												delete windows[uri];

												props.updatePolicy({
													...props.data,
													windows,
												});
											}}
										>
											Delete
										</Button>
									</div>
								)}
							</For>
							<Form form={form} fieldsetClass="flex space-x-3">
								<div class="flex-1">
									<InputField
										form={form}
										name="uri"
										placeholder="./Device/Vendor/MSFT/Policy/Config/Camera/AllowCamera"
										disabled={isDisabled()}
										onDblClick={(e) => {
											form.setFieldValue("uri", e.currentTarget.placeholder);
										}}
									/>
								</div>
								<div class="flex-1">
									<InputField
										form={form}
										name="value"
										placeholder="0"
										disabled={isDisabled()}
										onDblClick={(e) => {
											form.setFieldValue("value", e.currentTarget.placeholder);
										}}
									/>
								</div>
								<Button type="submit" class="w-16" disabled={isDisabled()}>
									Add
								</Button>
							</Form>
						</div>
					</div>

					<div>
						<h1 class="text-md font-semibold leading-none tracking-tight py-2">
							Apple
						</h1>

						<div class="flex justify-between">
							<input
								type="file"
								class="disabled:opacity-70"
								accept=".mobileconfig"
								disabled={isDisabled()}
								onInput={(e) => {
									const file = e.currentTarget.files?.[0];
									if (!file) return;
									file.text().then((text) => {
										props.updatePolicy({
											...(props.data || {}),
											apple: text,
										});
									});
								}}
							/>

							<Button
								variant="destructive"
								onClick={() => {
									const data = { ...(props.data || {}) };
									if ("apple" in data) data.apple = undefined;
									props.updatePolicy(data);
								}}
								disabled={isDisabled()}
							>
								Delete
							</Button>
						</div>

						<Show when={props.data?.apple}>
							{(value) => <pre>{value() as string}</pre>}
						</Show>
					</div>

					<div>
						<h1 class="text-md font-semibold leading-none tracking-tight py-2">
							Android
						</h1>
						<h2 class="text-muted-foreground opacity-70">Coming soon...</h2>
					</div>

					<div>
						<h1 class="text-md font-semibold leading-none tracking-tight py-2">
							Linux
						</h1>
						<h2 class="text-muted-foreground opacity-70">Coming soon...</h2>
					</div>
				</CardContent>
			</Card>
		</PageLayout>
	);
}
