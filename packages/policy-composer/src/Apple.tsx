import { Accordion } from "@kobalte/core/accordion";
import type { AppleProfilePayload } from "@mattrax/configuration-schemas/apple";
import {
	Badge,
	CardDescription,
	CardTitle,
	Checkbox,
	Input,
	NumberInput,
	NumberInputControl,
	NumberInputDecrementTrigger,
	NumberInputIncrementTrigger,
} from "@mattrax/ui";
import {
	For,
	Match,
	Show,
	Switch,
	createSignal,
	createUniqueId,
} from "solid-js";
import { createStore, produce } from "solid-js/store";

import { useController } from "./Context";

export function Apple(props: {
	payloads?: Record<string, AppleProfilePayload>;
}) {
	const controller = useController();

	return (
		<>
			<div class="flex-1 max-w-xl flex sticky top-12 flex-col max-h-[calc(100vh-3rem)] overflow-hidden">
				<div class="m-2">
					<Input class="z-20" placeholder="Search Payloads" />
				</div>
				<ul class="rounded-lg overflow-y-auto flex-1">
					<For
						each={Object.entries(props.payloads || {}).sort(([a], [b]) => {
							const aIsApple = a.startsWith("com.apple");
							const bIsApple = b.startsWith("com.apple");

							if (aIsApple && !bIsApple) return -1;
							if (!aIsApple && bIsApple) return 1;
							// biome-ignore lint/style/noUselessElse:
							else {
								return a.localeCompare(b);
							}
						})}
					>
						{([key, value]) => {
							const id = createUniqueId();
							return (
								<li class="flex flex-row items-center gap-4 px-4 py-1">
									<Checkbox
										id={id}
										onChange={(value) => {
											if (value)
												controller.setSelected("apple", key as any, {
													enabled: value,
													open: true,
													data: {},
												});
										}}
									/>
									<div class="overflow-hidden">
										<label for={`${id}-input`} class="font-medium">
											{value.title}
										</label>
										<p class="text-sm text-neutral-500 overflow-y-auto scrollbar-none">
											{key}
										</p>
									</div>
									{value.supervised && (
										<div class="flex-1 text-right">
											<Badge>Supervised</Badge>
										</div>
									)}
								</li>
							);
						}}
					</For>
				</ul>
			</div>
			<Accordion
				as="ul"
				class="flex-1 flex flex-col"
				multiple
				value={Object.entries(controller.selected.apple)
					.filter(([, payload]) => payload?.open)
					.map(([name]) => name)}
				onChange={(selectedValues) => {
					controller.setSelected(
						"apple",
						produce((values) => {
							for (const key of Object.keys(values)) {
								const v = values?.[key];
								if (!v) continue;

								v.open = selectedValues.includes(key);
							}
						}),
					);
				}}
			>
				<For
					each={Object.entries(controller.selected.apple).filter(
						([_, v]) => v?.enabled,
					)}
				>
					{([payloadKey, value]) => {
						const itemConfig = () => props.payloads![payloadKey];

						const when = () => {
							const c = itemConfig();
							if (c && value) return { itemConfig: c, value };
						};

						return (
							<Show when={when()} keyed>
								{({ itemConfig, value }) => (
									<Accordion.Item
										value={payloadKey}
										as="li"
										class="border-b border-gray-200"
									>
										<Accordion.Header class="shadow sticky top-12 bg-white z-10">
											<Accordion.Trigger
												as="div"
												class="p-4 flex flex-row justify-between items-center group gap-4"
											>
												<div class="flex-1">
													<CardTitle class="mb-1">{itemConfig.title}</CardTitle>
													<CardDescription>
														{itemConfig.description}
													</CardDescription>
												</div>
												{itemConfig.supervised && <Badge>Supervised</Badge>}
												<IconTablerChevronUp class="ml-auto ui-group-closed:rotate-180" />
											</Accordion.Trigger>
										</Accordion.Header>
										<Accordion.Content
											as="ul"
											class="space-y-3 p-4 transition-all animate-accordion-up data-[expanded]:animate-accordion-down overflow-hidden"
											onFocusIn={(e: FocusEvent) => e.stopPropagation()}
										>
											<For each={Object.entries(itemConfig.properties)}>
												{([key, property]) => {
													const id = createUniqueId();

													const [, setValue] = createStore(value.data[key]);

													return (
														<li>
															<div class="flex flex-row items-center gap-1.5 relative">
																{value.data[key] && (
																	<button
																		type="button"
																		onClick={() =>
																			setValue("data", key, undefined!)
																		}
																		class="w-2 h-2 bg-brand rounded-full absolute -left-3 top-1.5"
																	/>
																)}
																<Show when={property.type === "boolean"}>
																	<Checkbox
																		id={id}
																		checked={value.data[key] ?? false}
																		onChange={(checked) =>
																			setValue("data", key, checked)
																		}
																	/>
																</Show>
																<label
																	class="font-medium text-sm"
																	for={
																		property.type === "boolean"
																			? `${id}-input`
																			: id
																	}
																>
																	{property.title}
																</label>
															</div>
															{property.description && (
																<p class="text-sm text-neutral-500 !mt-0">
																	{property.description}
																</p>
															)}
															<Switch
																fallback={
																	property.type !== "boolean" &&
																	((() => {
																		const [open, setOpen] = createSignal(false);

																		return (
																			<>
																				<Badge onClick={() => setOpen(!open())}>
																					Type Not Implemented
																				</Badge>
																				{open() && (
																					<pre class="text-xs">
																						{JSON.stringify(
																							property.type,
																							null,
																							2,
																						)}
																					</pre>
																				)}
																			</>
																		);
																	}) as any)
																}
															>
																<Match when={property.type === "string"}>
																	<Input
																		id={id}
																		value={value.data[key] ?? ""}
																		type="text"
																		class="my-0.5"
																		onChange={(e) =>
																			setValue(e.currentTarget.value)
																		}
																	/>
																</Match>
																<Match
																	when={property.type === "integer" && property}
																>
																	<NumberInput
																		value={value.data[key] ?? 0}
																		class="my-0.5"
																		onRawValueChange={(value) =>
																			setValue(value)
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
															{property.supervised && <Badge>Supervised</Badge>}
														</li>
													);
												}}
											</For>
										</Accordion.Content>
									</Accordion.Item>
								)}
							</Show>
						);
					}}
				</For>
			</Accordion>
		</>
	);
}
