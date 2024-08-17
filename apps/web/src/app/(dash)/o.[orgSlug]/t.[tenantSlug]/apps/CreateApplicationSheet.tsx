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
	TabsList,
	TabsTrigger,
} from "@mattrax/ui";
import { Form, createZodForm } from "@mattrax/ui/forms/legacy";
import { debounce } from "@solid-primitives/scheduled";
import { useNavigate } from "@solidjs/router";
import { createQuery } from "@tanstack/solid-query";
import clsx from "clsx";
import {
	type Accessor,
	For,
	type JSX,
	Show,
	Suspense,
	createEffect,
	createSignal,
	startTransition,
} from "solid-js";
import { z } from "zod";
import { getObjectKeys } from "~/api/utils";
import { trpc } from "~/lib";
import { useTenantSlug } from "../ctx";

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
			queryKey: ["macOSStoreSearch", search()],
			queryFn: async () => {
				// TODO: Pagination support
				const res = await fetch(
					`https://itunes.apple.com/search?${new URLSearchParams({
						...(search() && { term: search() }),
						entity: "software",
					})}`,
				);
				const data = IOS_APP_SCHEMA.parse(await res.json());
				return data.results.map((result) => ({
					id: result.bundleId,
					name: result.trackName,
					author: result.sellerName,
					image: result.artworkUrl512,
				})) as App[];
			},
		}),
	},
	Windows: {
		display: "Windows Store",
		queryOptions: (search, ctx) => ({
			queryKey: ["windowsStoreSearch", search()],
			queryFn: async () => {
				// TODO: Pagination support
				const result = await ctx.app.searchWindowsStore.fetch({
					query: search(),
				});

				return result.Data.map((result) => ({
					id: result.PackageIdentifier,
					name: result.PackageName,
					author: result.Publisher,
				})) as App[];
			},
		}),
	},
} satisfies Record<
	string,
	{
		display: string;
		queryOptions: (
			search: Accessor<string>,
			ctx: ReturnType<typeof trpc.useContext>,
		) => any;
	}
>;

type App = {
	id: string;
	name: string;
	author: string;
	image?: string;
};

export function CreateApplicationSheet(props: {
	children?: (props: any) => JSX.Element;
}) {
	const tenantSlug = useTenantSlug();
	const navigate = useNavigate();

	const [open, setOpen] = createSignal(false);

	const createApplication = trpc.app.create.createMutation();
	const form = createZodForm(() => ({
		schema: z.object({
			targetType: z.custom<keyof typeof APPLICATION_TARGETS>(),
			targetId: z.string(),
		}),
		defaultValues: {
			// WARNING: This `as const` is to prevent Typescript crashing `Error: Debug Failure. No error for last overload signature`
			targetType: "iOS" as const,
			targetId: "",
		},
		onSubmit: async ({ value }) => {
			const app = await createApplication.mutateAsync({
				...value,
				name: query.data?.find((r) => r.id === value.targetId)?.name!,
				tenantSlug: tenantSlug(),
			});
			await startTransition(() => navigate(app.id));
		},
	}));

	const [search, setSearch] = createSignal("");

	const ctx = trpc.useContext();
	const query = createQuery(() => ({
		...APPLICATION_TARGETS[form.getFieldValue("targetType")].queryOptions(
			search,
			ctx,
		),
		enabled: open(),
		initialData: [],
	}));

	createEffect(() => {
		const results = query.data;
		if (!results) {
			form.setFieldValue("targetId", undefined!);
			return;
		}

		const first = results[0]?.id;
		if (!form.getFieldValue("targetId")) form.setFieldValue("targetId", first!);
		if (results.find((result) => result.id === form.getFieldValue("targetId")))
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
						<form.Field name="targetType">
							{(field) => (
								<Tabs
									value={field().state.value}
									onChange={(v) => field().handleChange(v as any)}
								>
									<TabsList>
										<For each={getObjectKeys(APPLICATION_TARGETS)}>
											{(target) => (
												<TabsTrigger value={target}>
													{APPLICATION_TARGETS[target].display}
												</TabsTrigger>
											)}
										</For>
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
					<form.Field name="targetId">
						{(field) => (
							<RadioGroup.Root
								class="flex-1 overflow-y-auto !mt-1.5"
								value={field().state.value}
								onChange={(v) => field().handleChange(v)}
							>
								<div class="p-1">
									<Suspense
										fallback={
											<p class="text-muted-foreground opacity-70">Loading...</p>
										}
									>
										<For
											each={query.data}
											fallback={
												<p class="text-muted-foreground opacity-70">
													No applications found...
												</p>
											}
										>
											{(app) => (
												<RadioGroup.Item value={app.id}>
													<RadioGroup.ItemInput class="peer" />
													<RadioGroup.ItemControl
														class={clsx(
															"flex flex-row p-2 gap-2 items-center rounded-md",
															"border-2 border-transparent ui-checked:border-brand peer-focus-visible:outline outline-brand",
														)}
													>
														<Show when={app.image}>
															<img
																src={app.image}
																alt=""
																class="rounded h-12"
															/>
														</Show>
														<div class="flex flex-col text-sm flex-1">
															<span class="font-semibold">{app.name}</span>
															<span class="text-gray-700">{app.author}</span>
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
