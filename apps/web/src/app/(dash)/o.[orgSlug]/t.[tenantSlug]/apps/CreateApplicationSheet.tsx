import { RadioGroup } from "@kobalte/core";
import {
	Button,
	Input,
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
	Tabs,
	TabsIndicator,
	TabsList,
	TabsTrigger,
} from "@mattrax/ui";
import { Form, createZodForm } from "@mattrax/ui/forms";
import { debounce } from "@solid-primitives/scheduled";
import { useNavigate } from "@solidjs/router";
import { createQuery } from "@tanstack/solid-query";
import clsx from "clsx";
import {
	type Accessor,
	For,
	type JSX,
	Suspense,
	createEffect,
	createSignal,
	startTransition,
} from "solid-js";
import { z } from "zod";
import { trpc } from "~/lib";
import { useTenantSlug } from "../../t.[tenantSlug]";

const IOS_APP_SCHEMA = z.object({
	results: z.array(
		z.object({
			artworkUrl512: z.string(),
			trackName: z.string(),
			sellerName: z.string(),
			bundleId: z.string(),
		}),
	),
});

const APPLICATION_TARGETS = {
	iOS: {
		display: "iOS/iPad OS",
		queryOptions: (search) => ({
			queryKey: ["appStoreSearch", search()],
			queryFn: async () => {
				// TODO: Pagination support
				const res = await fetch(
					`https://itunes.apple.com/search?${new URLSearchParams({
						...(search() && { term: search() }),
						entity: "software",
					})}`,
				);

				return IOS_APP_SCHEMA.parse(await res.json());
			},
		}),
	},
} satisfies Record<
	string,
	{ display: string; queryOptions: (search: Accessor<string>) => any }
>;

export function CreateApplicationSheet(props: {
	children?: (props: any) => JSX.Element;
}) {
	const tenantSlug = useTenantSlug();
	const navigate = useNavigate();

	const [open, setOpen] = createSignal(false);

	const createApplication = trpc.app.create.createMutation();
	const form = createZodForm({
		schema: z.object({
			targetType: z.custom<keyof typeof APPLICATION_TARGETS>(),
			targetId: z.string(),
		}),
		defaultValues: {
			targetType: "iOS",
			targetId: "",
		},
		onSubmit: async ({ value }) => {
			const app = await createApplication.mutateAsync({
				...value,
				name: query.data?.results.find((r) => r.bundleId === value.targetId)
					?.trackName!,
				tenantSlug: tenantSlug(),
			});
			await startTransition(() => navigate(app.id));
		},
	});

	const [search, setSearch] = createSignal("");

	const query = createQuery(() => {
		// debugger;
		return {
			...APPLICATION_TARGETS[form.getFieldValue("targetType")].queryOptions(
				search,
			),
			enabled: open(),
		};
	});

	createEffect(() => {
		const results = query.data?.results;
		if (!results) {
			form.setFieldValue("targetId", undefined!);
			return;
		}

		const first = results[0]?.bundleId;
		if (!form.getFieldValue("targetId")) form.setFieldValue("targetId", first!);
		if (
			results.find(
				(result) => result.bundleId === form.getFieldValue("targetId"),
			)
		)
			return;

		form.setFieldValue("targetId", first!);
	});

	return (
		<Sheet open={open()} onOpenChange={setOpen}>
			<SheetTrigger
				as={(triggerProps: any) => props.children?.(triggerProps)}
			/>
			<SheetContent padding="none">
				<Form
					form={form}
					class="h-full"
					fieldsetClass="p-6 overflow-hidden space-y-4 h-full flex flex-col"
				>
					<SheetHeader>
						<SheetTitle>Create Application</SheetTitle>
					</SheetHeader>
					<div class="flex flex-col space-y-1.5">
						<form.Field name="targetType" preserveValue>
							{(field) => (
								<Tabs
									value={field().state.value}
									onChange={(v) => field().handleChange(v as any)}
								>
									<TabsList>
										<For
											each={
												["iOS"] satisfies Array<
													keyof typeof APPLICATION_TARGETS
												>
											}
										>
											{(target) => (
												<TabsTrigger value={target}>
													{APPLICATION_TARGETS[target].display}
												</TabsTrigger>
											)}
										</For>
										{/*
                                <TabsTrigger value="macOS">macOS</TabsTrigger>
                                <TabsTrigger value="windows">Windows</TabsTrigger> */}
										<TabsIndicator />
									</TabsList>
								</Tabs>
							)}
						</form.Field>
						<Input
							placeholder="Search Targets..."
							value={search()}
							onKeyPress={(e) => e.key === "Enter" && e.preventDefault()}
							onInput={debounce((e) => setSearch(e.target.value), 200)}
						/>
					</div>
					<form.Field name="targetId" preserveValue>
						{(field) => (
							<RadioGroup.Root
								class="flex-1 overflow-y-auto !mt-1.5"
								value={field().state.value}
								onChange={(v) => field().handleChange(v)}
							>
								<div class="p-1">
									<Suspense>
										<For each={query.data?.results}>
											{(app) => (
												<RadioGroup.Item value={app.bundleId}>
													<RadioGroup.ItemInput class="peer" />
													<RadioGroup.ItemControl
														class={clsx(
															"flex flex-row p-2 gap-2 items-center rounded-md",
															"border-2 border-transparent ui-checked:border-brand peer-focus-visible:outline outline-brand",
														)}
													>
														<img
															src={app.artworkUrl512}
															alt=""
															class="rounded h-12"
														/>
														<div class="flex flex-col text-sm flex-1">
															<span class="font-semibold">{app.trackName}</span>
															<span class="text-gray-700">
																{app.sellerName}
															</span>
														</div>
													</RadioGroup.ItemControl>
												</RadioGroup.Item>
											)}
										</For>
									</Suspense>
								</div>
							</RadioGroup.Root>
						)}
					</form.Field>
					<Button type="submit" class="grow-0">
						Create
					</Button>
				</Form>
			</SheetContent>
		</Sheet>
	);
}
