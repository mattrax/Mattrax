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
} from "@mattrax/ui";
import { Match, createMemo, Switch, Show } from "solid-js";
import { For } from "solid-js";
import { createStore } from "solid-js/store";

import { WindowsCSP } from "@mattrax/configuration-schemas/windows";
import { AppleProfilePayload } from "@mattrax/configuration-schemas/apple";

export function createPolicyComposerController() {
	const [selected, setSelected] = createStore<{
		windows: Record<string, Record<string, { enabled: boolean; data: any }>>;
	}>({ windows: {} });

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
		<div>
			<Tabs class="w-full flex flex-col items-center">
				<TabsList>
					<TabsTrigger value="windows">Windows</TabsTrigger>
					<TabsTrigger value="apple">Apple</TabsTrigger>
					<TabsIndicator />
				</TabsList>
				<TabsContent value="windows" class="w-full h-full flex flex-row gap-4">
					<ul class="flex-1 gap-4 flex flex-col">
						<For each={Object.entries(props.controller.selected.windows)}>
							{([cspPath, csp]) => (
								<For each={Object.entries(csp).filter(([_, v]) => v?.enabled)}>
									{([key, value]) => {
										const itemConfig = () =>
											props.windowsCSPs[cspPath]?.policies[key];

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
																	when={
																		itemConfig.format === "int" && itemConfig
																	}
																	keyed
																>
																	{(itemConfig) => (
																		<Switch
																			fallback={
																				<NumberInput
																					defaultValue={itemConfig.defaultValue}
																					value={
																						value.data ??
																						itemConfig.defaultValue
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
																									{
																										props.item.rawValue
																											.description
																									}
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
																							defaultValue={
																								itemConfig.defaultValue
																							}
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
																	when={
																		itemConfig.format === "bool" && itemConfig
																	}
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
					<ul class="flex-1 overflow-hidden">
						<For each={Object.entries(props.windowsCSPs)}>
							{([cspKey, value]) => (
								<li class="p-2 items-center gap-4">
									<div class="overflow-hidden">
										<span class="font-medium">{value.name || cspKey}</span>
										<p class="text-sm text-neutral-500 overflow-y-auto scrollbar-none">
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
														<span class="font-medium">{value.name || key}</span>
														<p class="text-sm text-neutral-500 overflow-y-auto scrollbar-none">
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
				</TabsContent>
				<TabsContent value="apple" class="w-full h-full flex flex-row gap-4">
					<ul class="flex-1 gap-4 flex flex-col">
						<For
							each={Object.entries(props.controller.selected).filter(
								([_, v]) => v?.enabled,
							)}
						>
							{([key, value]) => {
								const itemConfig = () => props.windowsCSPs[key];

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
																<Switch fallback="unimplemented or lack of allowedValues">
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
																							{
																								data: value,
																							},
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
													</Switch>
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
							each={Object.entries(props.applePayloads).sort(([a], [b]) => {
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
												props.controller.setSelected(key as any, {
													enabled: value,
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
				</TabsContent>
			</Tabs>
		</div>
	);
}
