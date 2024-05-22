import { PolymorphicCallbackProps, RadioGroup } from "@kobalte/core";
import {
	Suspense,
	createSignal,
	For,
	createEffect,
	startTransition,
	type JSX,
} from "solid-js";
import { debounce } from "@solid-primitives/scheduled";
import { useNavigate } from "@solidjs/router";
import { createQuery } from "@tanstack/solid-query";
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
import { Form, createZodForm } from "@mattrax/ui/forms";
import { trpc } from "~/lib";
import { z } from "zod";
import clsx from "clsx";
import { useTenantSlug } from "../../t.[tenantSlug]";
import {
	DialogTriggerOptions,
	DialogTriggerRenderProps,
} from "@kobalte/core/dialog";
import { APPLICATION_TARGETS } from ".";

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

	const query = createQuery(() => ({
		...APPLICATION_TARGETS[form.getFieldValue("targetType")].queryOptions(
			search,
		),
		enabled: open(),
	}));

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
