import {
	Button,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@mattrax/ui";
import { createAsync } from "@solidjs/router";
import {
	type Accessor,
	For,
	Show,
	Suspense,
	createEffect,
	createMemo,
} from "solid-js";
import { createMutable } from "solid-js/store";
import { z } from "zod";
import { type Database, db } from "~/lib/db";
import { useSyncEngine } from "~/lib/sync";
import { useZodParams } from "~/lib/useZodParams";

export default function Page() {
	const sync = useSyncEngine();
	const params = useZodParams({
		policyId: z.string(),
	});

	// TODO: Make this reactive to DB changes
	const data = createAsync(
		async () => await (await db).get("policies", params.policyId),
	);

	// TODO: 404 handling

	const configurationSettings = createAsync(
		// TODO: This is cripplingly slow on first load
		async () => await new Promise((resolve) => {}),
		// TODO: await getConfigurationSettings(await sync.getAccessToken()),
	);

	const configurationCategories = createAsync(
		async () => await new Promise((resolve) => {}),
		// TODO: await getConfigurationCategories(await sync.getAccessToken()),
	);

	const state = createMutable<Record<string, any>>({});

	createEffect(() => console.log(data())); // TODO

	createEffect(() => console.log("SETTINGS", configurationSettings())); // TODO

	return (
		<div class="p-4">
			<Suspense
				fallback={
					<>
						<p>Loading...</p>
						<p class="text-red-500">
							Warning: This will be stupidly (like 20 seconds) slow on first
							load.
						</p>
					</>
				}
			>
				<h1 class="text-2xl">{data()?.name}</h1>

				<Button
					onClick={() => {
						console.log(state);
						// TODO: Save
					}}
				>
					Save
				</Button>

				{/* // TODO: Actions like delete, open in Azure & export to json */}

				{/* // TODO: Manage assignments */}
				{/* // TODO: Show deployment status */}

				<Show when={data()}>
					{(data) => (
						<RenderSettingsCatalog
							policy={data()}
							configurationSettings={configurationSettings()}
							configurationCategories={configurationCategories()}
							state={state}
						/>
					)}
				</Show>
			</Suspense>
		</div>
	);
}

function RenderSettingsCatalog(props: {
	policy: Database["policies"]["value"];
	configurationSettings: Accessor<any>;
	configurationCategories: Accessor<any>;
	state: Record<string, any>;
}) {
	if ((!"settings") in props.policy)
		return <div>This policy is not a settings catalog!</div>;

	const categories = createMemo(() => {
		const categories: Record<string, string[]> = {};

		for (const setting of props.policy.settings) {
			const definition = props.configurationSettings?.value?.find(
				(s) => s.id === setting.settingInstance.settingDefinitionId,
			);
			if (!definition) continue; // TODO: Async stuff throw new Error("Invalid setting definition");

			if (!categories[definition.categoryId])
				categories[definition.categoryId] = [];
			categories[definition.categoryId]!.push(definition);
		}

		// TODO: move this bit into JSX???
		return Object.fromEntries(
			Object.entries(categories).map(([categoryId, value]) => [
				props.configurationCategories?.value?.find((c) => c.id === categoryId)
					?.displayName || "loading",
				value,
			]),
		);
	});

	return (
		<>
			<div class="flex flex-col space-y-4">
				<For each={Object.entries(categories())}>
					{([key, definitions]) => (
						<div>
							<h2 class="text-xl">{key}</h2>

							{/* // TODO: Warning when not all options in category are enabled */}

							<div class="flex flex-col space-y-2">
								<For each={definitions}>
									{(definition) => {
										// @ts-expect-error
										const setting = props.policy.settings.find(
											(s) =>
												s.settingInstance.settingDefinitionId === definition.id,
										);

										// TODO: Set in render is kinda bad
										props.state[definition.id] =
											setting.settingInstance.choiceSettingValue.value;

										// TODO: `setting.settingInstanceTemplateReference`

										// TODO: Handle `applicability`
										// TODO: Handle `occurrence`

										// TODO: `categoryId` -> Render as proper categories

										// TODO: `defaultOptionId`

										// TODO: `infoUrls` render links to docs

										// createEffect(() => {
										// 	console.log("SET", setting, definition());

										// 	console.log(
										// 		definition().options?.find(
										// 			(o) => o.id === setting.settingInstance.value,
										// 		),
										// 	);
										// });

										// TODO: `settingUsage`
										// TODO: `uxBehavior`
										// TODO: `version`

										const content = () => {
											if (
												definition["@odata.type"] ===
												"#microsoft.graph.deviceManagementConfigurationChoiceSettingDefinition"
											) {
												const items = Object.fromEntries(
													definition.options.map((o: any) => [o.itemId, o]),
												);

												// TODO: Determine when to use `Switch` over `Select`???
												return (
													<Select
														value={
															setting.settingInstance.choiceSettingValue.value
														}
														// onChange={setValue} // TODO
														options={Object.keys(items)}
														// placeholder="Select a fruit…" // TODO
														itemComponent={(props) => (
															<SelectItem item={props.item}>
																{items[props.item.rawValue].displayName}
															</SelectItem>
														)}
													>
														<SelectTrigger aria-label="Fruit" class="w-[180px]">
															<SelectValue<string>>
																{(state) =>
																	items[state.selectedOption()].displayName
																}
															</SelectValue>
														</SelectTrigger>
														<SelectContent />
													</Select>
												);
											}

											return <p class="text-red-500">Invalid Option</p>;
										};

										return (
											<div class="flex items-center space-x-2">
												<h3>{definition.displayName}</h3>

												<Tooltip>
													<TooltipTrigger as={IconPhInfo} />
													{/* // TODO: Handle long descriptions by line wrapping vertically */}
													<TooltipContent>
														{definition?.description}
													</TooltipContent>
												</Tooltip>

												{content()}

												{/* // TODO: Remove this setting from policy */}
											</div>
										);
									}}
								</For>
							</div>
						</div>
					)}
				</For>
			</div>
		</>
	);
}
