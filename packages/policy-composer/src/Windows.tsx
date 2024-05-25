import type { WindowsCSP } from "@mattrax/configuration-schemas/windows";
import {
	Badge,
	CardTitle,
	Checkbox,
	Input,
	NumberInput,
	NumberInputControl,
	NumberInputDecrementTrigger,
	NumberInputIncrementTrigger,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@mattrax/ui";
import { createVirtualizer } from "@tanstack/solid-virtual";
import { For, Match, Show, Suspense, Switch, createMemo } from "solid-js";
import { createStore } from "solid-js/store";

import { useController } from "./Context";

export function Windows(props: { csps?: Record<string, WindowsCSP> }) {
	const controller = useController();

	return (
		<>
			<div class="flex-1 max-w-xl flex sticky top-12 flex-col max-h-[calc(100vh-3rem)] overflow-hidden">
				<div class="m-2">
					<Input class="z-20" placeholder="Search Configurations" disabled />
				</div>
				<Suspense
					fallback={<div class="h-[9999px] border-t border-gray-200" />}
				>
					<Show when>
						{(_) => {
							let payloadsScrollRef: HTMLDivElement;

							const csps = createMemo(() =>
								Object.entries(props.csps || {}).sort(([, a], [, b]) =>
									a.name.localeCompare(b.name),
								),
							);

							const payloadsVirtualizer = createVirtualizer({
								get count() {
									return csps().length;
								},
								getScrollElement: () => payloadsScrollRef,
								estimateSize: (i) => {
									return 70 + Object.keys(csps()[i]![1]!.policies).length * 60;
								},
								overscan: 10,
							});

							return (
								<div
									class="overflow-y-auto flex-1 relative border-t border-gray-200"
									ref={payloadsScrollRef!}
								>
									<ul
										class="divide-y divide-gray-200 w-full relative"
										style={{
											height: `${payloadsVirtualizer.getTotalSize()}px`,
										}}
									>
										<For
											each={payloadsVirtualizer
												.getVirtualItems()
												.map((item) => [item, csps()[item.index]!] as const)}
										>
											{([item, [cspKey, value]]) => (
												<li
													class="absolute top-0 left-0 w-full overflow-hidden"
													style={{
														height: `${item.size}px`,
														transform: `translateY(${item.start}px)`,
														contain: "paint",
													}}
												>
													<div class="px-4 py-3 bg-white w-full truncate shadow">
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
																<li class="flex flex-row py-2 px-4 items-center gap-4">
																	<Checkbox
																		checked={
																			controller.state.windows[cspKey]?.[key]
																				?.enabled ?? false
																		}
																		onChange={(checked) => {
																			controller.setState("windows", cspKey, {
																				[key]: {
																					enabled: checked,
																					data: null,
																				},
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
																	{value.scope && (
																		<div class="flex-1 text-right">
																			<Badge>
																				{value.scope === "user"
																					? "User"
																					: "Device"}
																			</Badge>
																		</div>
																	)}
																</li>
															)}
														</For>
													</ul>
												</li>
											)}
										</For>
									</ul>
								</div>
							);
						}}
					</Show>
				</Suspense>
			</div>
			<ul class="flex-1 flex flex-col divide-y divide-y-200">
				<For each={Object.entries(controller.state.windows)}>
					{([cspPath, csp]) => (
						<For each={Object.entries(csp).filter(([_, v]) => v?.enabled)}>
							{([key, value]) => {
								const itemConfig = () => props.csps![cspPath]?.policies[key];

								const when = () => {
									const c = itemConfig();
									if (c && value) return { itemConfig: c, value };
								};

								return (
									<Show when={when()} keyed>
										{({ itemConfig, value }) => {
											const [, setValue] = createStore(value);

											return (
												<li class="block p-4 space-y-3">
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
																				setValue({ data: value })
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
																						setValue({ data: option.value });
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
																						setValue({ data: value })
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
																	setValue({ data: e.currentTarget.value })
																}
															/>
														</Match>
														<Match
															when={itemConfig.format === "bool" && itemConfig}
														>
															<Checkbox
																checked={value.data}
																onChange={(checked) =>
																	setValue({ data: checked })
																}
															/>
														</Match>
													</Switch>
												</li>
											);
										}}
									</Show>
								);
							}}
						</For>
					)}
				</For>
			</ul>
		</>
	);
}
