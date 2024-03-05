export default function Page() {
	return <h1>TODO</h1>;
}

// import { Show, For, createEffect, createSignal } from "solid-js";
// import { z } from "zod";
// import { useTenant } from "~/app/(dash)/[tenantSlug]";
// import { Form, InputField, createZodForm } from "~/components/forms";
// import {
// 	Button,
// 	Card,
// 	CardHeader,
// 	CardTitle,
// 	Badge,
// 	CardContent,
// 	Input,
// 	DialogRoot,
// 	DialogContent,
// 	DialogDescription,
// 	DialogHeader,
// 	DialogTitle,
// 	DialogTrigger,
// 	Textarea,
// 	createController,
// } from "~/components/ui";
// import { trpc } from "~/lib";
// import { useZodParams } from "~/lib/useZodParams";
// import { match } from "ts-pattern";
// import { As } from "@kobalte/core";
// import { RouterOutput } from "~/api";
// import { PageLayout } from "~/app/(dash)/[tenantSlug]/PageLayout";

// export default function Page() {
// 	const tenant = useTenant();
// 	const params = useZodParams({
// 		policyId: z.string(),
// 		versionId: z.string(),
// 	});
// 	const policy = trpc.policy.get.useQuery(() => ({
// 		tenantSlug: tenant().slug,
// 		policyId: params.policyId,
// 	}));

// 	const version = trpc.policy.getVersion.useQuery(() => ({
// 		tenantSlug: tenant().slug,
// 		policyId: params.policyId,
// 		versionId: params.versionId,
// 	}));

// 	const updateVersion = trpc.policy.updateVersion.useMutation(() => ({
// 		onSuccess: () => version.refetch(),
// 	}));
// 	const form = createZodForm({
// 		schema: z.object({
// 			uri: z.string(),
// 			value: z.string(),
// 		}),
// 		onSubmit: (values) =>
// 			updateVersion.mutateAsync({
// 				tenantSlug: tenant().slug,
// 				policyId: params.policyId,
// 				versionId: params.versionId,
// 				data: {
// 					...(version.data || {}),
// 					windows: {
// 						...((version.data as any)?.windows || {}),
// 						[values.value.uri]: values.value.value,
// 					},
// 				},
// 			}),
// 	});

// 	const isDisabled = () =>
// 		version.isLoading ||
// 		updateVersion.isPending ||
// 		version.data?.status !== "open";

// 	const refetch = async () => {
// 		await Promise.allSettled([policy.refetch(), version.refetch()]);
// 	};

// 	return (
// 			<Show when={version.data}>
// 				{(version) => (
// 				<PageLayout class="pt-4">
// 					<Card>
// 						<CardHeader class="flex-row justify-between">
// 							<div class="flex space-x-2 justify-center items-center">
// 								<CardTitle>{version().id}</CardTitle>
// 								<div>
// 									{match(version().status)
// 										.with("open", () => <></>)
// 										.with("deploying", () => (
// 											<Badge variant="default" class="animate-pulse">
// 												Deploying
// 											</Badge>
// 										))
// 										.with("deployed", () => (
// 											<Badge variant="default">Deployed</Badge>
// 										))
// 										.exhaustive()}
// 								</div>
// 							</div>

// 							<DeployButton
// 								policyId={params.policyId}
// 								version={version()}
// 								refetch={refetch}
// 							/>
// 						</CardHeader>
// 						<CardContent class="flex flex-col space-y-4">
// 							<div>
// 								<Show when={version().status !== "open"}>
// 									<p>
// 										Deployed by {version().deployedBy} with comment '
// 										{version().deployComment}' at{" "}
// 										{version().deployedAt?.toString()}
// 									</p>
// 								</Show>

// 								<h1 class="text-md font-semibold leading-none tracking-tight py-2">
// 									Windows
// 								</h1>
// 								<div class="flex flex-col space-y-3">
// 									<For
// 										each={Object.entries(
// 											(version().data as any)?.windows || {},
// 										)}
// 									>
// 										{([uri, value]) => (
// 											<div class="flex space-x-3">
// 												<Input
// 													value={uri}
// 													class="flex-1"
// 													disabled={isDisabled() || true}
// 												/>
// 												<Input
// 													value={value as string}
// 													class="flex-1"
// 													disabled={isDisabled() || true}
// 												/>
// 												<Button
// 													variant="destructive"
// 													class="w-16"
// 													disabled={isDisabled()}
// 													onClick={() => {
// 														const windows = {
// 															...((version().data as any)?.windows || {}),
// 														};
// 														delete windows[uri];
// 														updateVersion.mutateAsync({
// 															tenantSlug: tenant().slug,
// 															policyId: params.policyId,
// 															versionId: params.versionId,
// 															data: {
// 																...(version().data || {}),
// 																windows,
// 															},
// 														});
// 													}}
// 												>
// 													Delete
// 												</Button>
// 											</div>
// 										)}
// 									</For>

// 									<Form form={form} fieldsetClass="flex space-x-3">
// 										<div class="flex-1">
// 											<InputField
// 												form={form}
// 												name="uri"
// 												placeholder="./Device/Vendor/MSFT/Policy/Config/Camera/AllowCamera"
// 												disabled={isDisabled()}
// 												onDblClick={(e) => {
// 													form.setFieldValue(
// 														"uri",
// 														e.currentTarget.placeholder,
// 													);
// 												}}
// 											/>
// 										</div>
// 										<div class="flex-1">
// 											<InputField
// 												form={form}
// 												name="value"
// 												placeholder="0"
// 												disabled={isDisabled()}
// 												onDblClick={(e) => {
// 													form.setFieldValue(
// 														"value",
// 														e.currentTarget.placeholder,
// 													);
// 												}}
// 											/>
// 										</div>
// 										<Button type="submit" class="w-16" disabled={isDisabled()}>
// 											Add
// 										</Button>
// 									</Form>
// 								</div>
// 							</div>
// 							<div>
// 								<h1 class="text-md font-semibold leading-none tracking-tight py-2">
// 									Apple
// 								</h1>

// 								<div class="flex justify-between">
// 									<input
// 										type="file"
// 										class="disabled:opacity-70"
// 										accept=".mobileconfig"
// 										disabled={isDisabled()}
// 										onInput={(e) => {
// 											const file = e.currentTarget.files?.[0];
// 											if (!file) return;
// 											file.text().then((text) => {
// 												updateVersion.mutateAsync({
// 													tenantSlug: tenant().slug,
// 													policyId: params.policyId,
// 													versionId: params.versionId,
// 													data: {
// 														...(version().data || {}),
// 														apple: text,
// 													},
// 												});
// 											});
// 										}}
// 									/>

// 									<Button
// 										variant="destructive"
// 										onClick={() => {
// 											const data = { ...(version().data || {}) };
// 											if ("apple" in data) data.apple = undefined;
// 											updateVersion.mutateAsync({
// 												tenantSlug: tenant().slug,
// 												policyId: params.policyId,
// 												versionId: params.versionId,
// 												data,
// 											});
// 										}}
// 										disabled={isDisabled()}
// 									>
// 										Delete
// 									</Button>
// 								</div>

// 								<Show when={(version().data as any)?.apple}>
// 									{(value) => <pre>{value()}</pre>}
// 								</Show>
// 							</div>

// 							<div>
// 								<h1 class="text-md font-semibold leading-none tracking-tight py-2">
// 									Android
// 								</h1>
// 								<h2 class="text-muted-foreground opacity-70">Coming soon...</h2>
// 							</div>

// 							<div>
// 								<h1 class="text-md font-semibold leading-none tracking-tight py-2">
// 									Linux
// 								</h1>
// 								<h2 class="text-muted-foreground opacity-70">Coming soon...</h2>
// 							</div>
// 						</CardContent>
// 					</Card>
// 					</PageLayout>
// 				)}
// 			</Show>
// 				);
// }
