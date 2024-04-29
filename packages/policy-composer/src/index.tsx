import {
	Card,
	CardTitle,
	Checkbox,
	NumberField,
	NumberFieldDecrementTrigger,
	NumberFieldIncrementTrigger,
	NumberFieldInput,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@mattrax/ui";
import { Match, createMemo, Switch, Show } from "solid-js";
import { For } from "solid-js";
import { createStore } from "solid-js/store";

import { WindowsDDFPolicy } from "@mattrax/configuration-schemas/windows";

export function createPolicyComposerController() {
	const [selected, setSelected] = createStore<
		Record<string, { enabled: boolean; data: any }>
	>({});

	return { selected, setSelected };
}

export type VisualEditorController = ReturnType<
	typeof createPolicyComposerController
>;

export function PolicyComposer(props: {
	controller: VisualEditorController;
	windowsPolicies: Record<string, WindowsDDFPolicy>;
}) {
	return (
		<div class="w-full h-full flex flex-row gap-4">
			<ul class="flex-1 gap-4 flex flex-col">
				<For
					each={Object.entries(props.controller.selected).filter(
						([_, v]) => v?.enabled,
					)}
				>
					{([key, value]) => {
						const itemConfig = () => props.windowsPolicies[key];

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
																		Object.entries(allowedValues().enum).map(
																			([value, config]) => ({
																				...config,
																				value,
																			}),
																		),
																	);

																	const selectValue = createMemo(() =>
																		options().find(
																			(o) =>
																				o.value ===
																				(value.data ?? itemConfig.defaultValue),
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
																		<NumberField
																			minValue={allowedValues().min}
																			maxValue={allowedValues().max}
																			defaultValue={itemConfig.defaultValue}
																			value={
																				value.data ?? itemConfig.defaultValue
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
																				<NumberFieldInput />
																				<NumberFieldIncrementTrigger />
																				<NumberFieldDecrementTrigger />
																			</div>
																		</NumberField>
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
				<For each={Object.entries(props.windowsPolicies)}>
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
								<span class="font-medium">{value.name}</span>
								<p class="text-sm text-neutral-500 overflow-y-auto scrollbar-none">
									{key}
								</p>
							</div>
						</li>
					)}
				</For>
			</ul>
		</div>
	);
}
