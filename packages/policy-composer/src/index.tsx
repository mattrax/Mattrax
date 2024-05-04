import {
	Card,
	CardTitle,
	Checkbox,
	Input,
	NumberInput,
	NumberInputDecrementTrigger,
	NumberInputIncrementTrigger,
	NumberInputControl,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Tabs,
	TabsContent,
	TabsIndicator,
	TabsList,
	TabsTrigger,
	CardDescription,
} from "@mattrax/ui";
import { Match, createMemo, Switch, Show, createUniqueId } from "solid-js";
import { For } from "solid-js";
import { createStore } from "solid-js/store";

import type { WindowsCSP } from "@mattrax/configuration-schemas/windows";
import type { AppleProfilePayload } from "@mattrax/configuration-schemas/apple";

export function createPolicyComposerController() {
	const [selected, setSelected] = createStore<{
		windows: Record<string, Record<string, { enabled: boolean; data: any }>>;
		apple: Record<string, { enabled: boolean; data: Record<string, any> }>;
	}>({ windows: {}, apple: {} });

	return { selected, setSelected };
}

export type VisualEditorController = ReturnType<
	typeof createPolicyComposerController
>;

export function PolicyComposer(props: {
	controller: VisualEditorController;
	windowsCSPs: Record<string, WindowsCSP>;
	applePayloads: Record<string, AppleProfilePayload>;
}) {
	return (
		<Tabs class="w-full flex flex-col items-center" value="apple">
			<TabsList>
				<TabsTrigger value="windows">Windows</TabsTrigger>
				<TabsTrigger value="apple">Apple</TabsTrigger>
				<TabsIndicator />
			</TabsList>
			<TabsContent value="windows" class="w-full h-full flex flex-row pt-2">
				<Windows controller={props.controller} csps={props.windowsCSPs} />
			</TabsContent>
			<TabsContent value="apple" class="w-full h-full flex flex-row gap-4">
				<Apple controller={props.controller} payloads={props.applePayloads} />
			</TabsContent>
		</Tabs>
	);
}

function Windows(props: {
	csps: Record<string, WindowsCSP>;
	controller: VisualEditorController;
}) {
	return (
		<>
			<ul class="flex-1 gap-4 flex flex-col p-2">
				<For each={Object.entries(props.controller.selected.windows)}>
					{([cspPath, csp]) => (
						<For each={Object.entries(csp).filter(([_, v]) => v?.enabled)}>
							{([key, value]) => {
								const itemConfig = () => props.csps[cspPath]?.policies[key];

								const when = () => {
									const c = itemConfig();
									if (c && value) return { itemConfig: c, value };
								};

								return (
									<Show when={when()} keyed>
										{({ itemConfig, value }) => (
											<div>
												<Card class="p-4 space-y-4">
													<CardTitle>{itemConfig.name}</CardTitle>
													<Switch
														fallback={`unimplemented format (${itemConfig.format})`}
													>
														<Match
															when={itemConfig.format === "int" && itemConfig}
															keyed
														>
															{(itemConfig) => (
																<Switch
																	fallback={
																		<NumberInput
																			defaultValue={itemConfig.defaultValue}
																			value={
																				value.data ?? itemConfig.defaultValue
																			}
																			onChange={(value) =>
																				props.controller.setSelected(
																					"windows",
																					cspPath,
																					key,
																					{ data: value },
																				)
																			}
																		>
																			<div class="relative">
																				<NumberInputControl />
																				<NumberInputIncrementTrigger />
																				<NumberInputDecrementTrigger />
																			</div>
																		</NumberInput>
																	}
																>
																	<Match
																		when={
																			itemConfig.allowedValues &&
																			itemConfig.allowedValues.valueType ===
																				"enum" &&
																			itemConfig.allowedValues
																		}
																	>
																		{(allowedValues) => {
																			const options = createMemo(() =>
																				Object.entries(
																					allowedValues().enum,
																				).map(([value, config]) => ({
																					...config,
																					value,
																				})),
																			);

																			const selectValue = createMemo(() =>
																				options().find(
																					(o) =>
																						o.value ===
																						(value.data ??
																							itemConfig.defaultValue),
																				),
																			);

																			type Option = ReturnType<
																				typeof options
																			>[number];

																			return (
																				<Select<Option>
																					options={options()}
																					multiple={false}
																					defaultValue={options().find(
																						(o) =>
																							o.value ===
																							itemConfig.defaultValue.toString(),
																					)}
																					optionValue="value"
																					optionTextValue="description"
																					optionDisabled={() => false}
																					itemComponent={(props) => (
																						<SelectItem item={props.item}>
																							{props.item.rawValue.description}
																						</SelectItem>
																					)}
																					value={selectValue()}
																					onChange={(option) => {
																						console.log(option);
																						props.controller.setSelected(
																							key as any,
																							{
																								data: option.value,
																							},
																						);
																					}}
																				>
																					<SelectTrigger>
																						<SelectValue<Option>>
																							{(state) => (
																								<>
																									{
																										state.selectedOption()
																											.description
																									}
																								</>
																							)}
																						</SelectValue>
																					</SelectTrigger>
																					<SelectContent />
																				</Select>
																			);
																		}}
																	</Match>
																	<Match
																		when={
																			itemConfig.allowedValues &&
																			itemConfig.allowedValues.valueType ===
																				"range" &&
																			itemConfig.allowedValues
																		}
																	>
																		{(allowedValues) => {
																			return (
																				<NumberInput
																					minValue={allowedValues().min}
																					maxValue={allowedValues().max}
																					defaultValue={itemConfig.defaultValue}
																					value={
																						value.data ??
																						itemConfig.defaultValue
																					}
																					onChange={(value) =>
																						props.controller.setSelected(
																							key as any,
																							{ data: value },
																						)
																					}
																				>
																					<div class="relative">
																						<NumberInputControl />
																						<NumberInputIncrementTrigger />
																						<NumberInputDecrementTrigger />
																					</div>
																				</NumberInput>
																			);
																		}}
																	</Match>
																</Switch>
															)}
														</Match>
														<Match
															when={
																itemConfig.format === "string" && itemConfig
															}
														>
															<Input
																value={value.data}
																onChange={(e) =>
																	props.controller.setSelected(
																		"windows",
																		cspPath,
																		key,
																		{ data: e.currentTarget.value },
																	)
																}
															/>
														</Match>
														<Match
															when={itemConfig.format === "bool" && itemConfig}
														>
															<Checkbox
																checked={value.data}
																onChange={(checked) =>
																	props.controller.setSelected(
																		"windows",
																		cspPath,
																		key,
																		{ data: checked },
																	)
																}
															/>
														</Match>
													</Switch>
												</Card>
											</div>
										)}
									</Show>
								);
							}}
						</For>
					)}
				</For>
			</ul>
			<div class="flex-1 flex sticky top-14 space-y-4 flex-col max-h-[calc(100vh-4rem)] overflow-hidden p-2">
				<Input class="z-20" placeholder="Search Configurations" disabled />
				<div class="flex-1 overflow-hidden flex">
					<ul class="rounded-lg space-y-4 overflow-y-auto flex-1">
						<For each={Object.entries(props.csps)}>
							{([cspKey, value]) => (
								<li
									class="items-center gap-4 rounded-lg border-gray-200 border"
									style="contain:paint"
								>
									<div class="px-4 py-3 sticky top-0 bg-white rounded-t-lg w-full truncate shadow border-t border-gray-200 -mt-px">
										<span class="font-medium truncate">
											{value.name || cspKey}
										</span>
										<p class="text-sm text-neutral-500 overflow-y-auto scrollbar-none truncate">
											{cspKey}
										</p>
									</div>
									<ul>
										<For each={Object.entries(value.policies)}>
											{([key, value]) => (
												<li class="flex flex-row p-2 items-center gap-4">
													<Checkbox
														checked={
															props.controller.selected.windows[cspKey]?.[key]
																?.enabled ?? false
														}
														onChange={(checked) => {
															props.controller.setSelected("windows", cspKey, {
																[key]: { enabled: checked, data: null },
															});
														}}
													/>
													<div>
														<span class="font-medium truncate">
															{value.name || key}
														</span>
														<p class="text-sm text-neutral-500 overflow-y-auto scrollbar-none truncate">
															{key}
														</p>
													</div>
												</li>
											)}
										</For>
									</ul>
								</li>
							)}
						</For>
					</ul>
				</div>
			</div>
		</>
	);
}

function Apple(props: {
	payloads: Record<string, AppleProfilePayload>;
	controller: VisualEditorController;
}) {
	return (
		<>
			<ul class="flex-1 gap-4 flex flex-col">
				<For
					each={Object.entries(props.controller.selected.apple).filter(
						([_, v]) => v?.enabled,
					)}
				>
					{([payloadKey, value]) => {
						const itemConfig = () => props.payloads[payloadKey];

						const when = () => {
							const c = itemConfig();
							if (c && value) return { itemConfig: c, value };
						};

						return (
							<Show when={when()} keyed>
								{({ itemConfig, value }) => (
									<div>
										<Card class="p-4">
											<CardTitle>{itemConfig.title}</CardTitle>
											<CardDescription class="mt-1">
												{itemConfig.description}
											</CardDescription>
											<hr class="h-px w-full border-gray-300 my-2" />
											<ul class="space-y-2">
												<For each={Object.entries(itemConfig.properties)}>
													{([key, property]) => {
														const id = createUniqueId();

														return (
															<li class="flex flex-col">
																<div class="flex flex-row items-center gap-2">
																	<label
																		class="font-medium mb-0.5 text-sm relative"
																		for={id}
																	>
																		{key in value.data && (
																			<button
																				onClick={() =>
																					props.controller.setSelected(
																						"apple",
																						payloadKey,
																						"data",
																						key,
																						undefined!,
																					)
																				}
																				class="w-2 h-2 bg-brand rounded-full absolute -left-3 top-1.5"
																			/>
																		)}
																		{property.title}
																	</label>
																	<Show when={property.type === "boolean"}>
																		<Checkbox
																			checked={value.data[key] ?? false}
																			onChange={(checked) =>
																				props.controller.setSelected(
																					"apple",
																					payloadKey,
																					"data",
																					{ [key]: checked },
																				)
																			}
																		/>
																	</Show>
																</div>
																<Switch>
																	<Match when={property.type === "string"}>
																		<Input
																			id={id}
																			value={value.data[key] ?? ""}
																			onChange={(e) =>
																				props.controller.setSelected(
																					"apple",
																					payloadKey,
																					"data",
																					{ [key]: e.currentTarget.value },
																				)
																			}
																		/>
																	</Match>
																	<Match
																		when={
																			property.type === "integer" && property
																		}
																	>
																		<NumberInput
																			value={value.data[key] ?? 0}
																			onChange={(value) =>
																				props.controller.setSelected(
																					"apple",
																					payloadKey,
																					"data",
																					{ [key]: Number.parseInt(value) },
																				)
																			}
																		>
																			<div class="relative">
																				<NumberInputControl id={id} />
																				<NumberInputIncrementTrigger />
																				<NumberInputDecrementTrigger />
																			</div>
																		</NumberInput>
																	</Match>
																</Switch>
															</li>
														);
													}}
												</For>
											</ul>
										</Card>
									</div>
								)}
							</Show>
						);
					}}
				</For>
			</ul>
			<ul class="flex-1 overflow-hidden">
				<For
					each={Object.entries(props.payloads).sort(([a], [b]) => {
						const aIsApple = a.startsWith("com.apple");
						const bIsApple = b.startsWith("com.apple");

						if (aIsApple && !bIsApple) return -1;
						if (!aIsApple && bIsApple) return 1;
						else {
							return a.localeCompare(b);
						}
					})}
				>
					{([key, value]) => (
						<li class="flex flex-row p-2 items-center gap-4">
							<Checkbox
								onChange={(value) => {
									if (value)
										props.controller.setSelected("apple", key as any, {
											enabled: value,
											data: {},
										});
								}}
							/>
							<div class="overflow-hidden">
								<span class="font-medium">{value.title}</span>
								<p class="text-sm text-neutral-500 overflow-y-auto scrollbar-none">
									{key}
								</p>
							</div>
						</li>
					)}
				</For>
			</ul>
		</>
	);
}
