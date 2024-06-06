import { Accordion } from "@kobalte/core/accordion";
import type { WindowsCSP } from "@mattrax/configuration-schemas/windows";
import {
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
import {
	For,
	Match,
	Show,
	Switch,
	createMemo,
	createSignal,
	createUniqueId,
} from "solid-js";
import { createStore, produce } from "solid-js/store";

import { useController } from "./Context";

function docsURL(name: string, path: string) {
	const BASE_URL =
		"https://learn.microsoft.com/en-gb/windows/client-management/mdm";

	const sanitisedName = name.toLowerCase().replace("_", "-");

	if (path.includes("/Policy/"))
		return `${BASE_URL}/policy-csp-${sanitisedName}`;

	return `${BASE_URL}/${sanitisedName}-csp`;
}

export function Windows(props: { csps?: Record<string, WindowsCSP> }) {
	const controller = useController();

	return (
		<>
			<CSPS csps={props.csps} />
			<Accordion
				as="ul"
				class="flex-1 flex flex-col"
				multiple
				value={Object.entries(controller.state.windows ?? {})
					.filter(([, payload]) => payload?.open)
					.map(([name]) => name)}
				onChange={(selectedValues) => {
					controller.setState(
						"windows",
						produce((values) => {
							for (const key of Object.keys(controller.state.windows ?? {})) {
								const v = values?.[key];
								if (!v) continue;

								v.open = selectedValues.includes(key);
							}
						}),
					);
				}}
			>
				<For
					each={Object.entries(controller.state.windows ?? {}).filter(
						([_, v]) => v?.enabled,
					)}
				>
					{([payloadKey, value]) => {
						const itemConfig = () => props.csps![payloadKey];

						const when = () => {
							const c = itemConfig();
							if (c && value) return { itemConfig: c, value };
						};

						return (
							<Show when={when()} keyed>
								{({ itemConfig, value }) => {
									const [, setData] = createStore(value.data);

									return (
										<Accordion.Item
											value={payloadKey}
											as="li"
											class="border-b border-gray-200"
										>
											<Accordion.Header class="shadow sticky top-12 bg-white z-10">
												<Accordion.Trigger
													as="div"
													class="px-6 py-4 flex flex-row justify-between items-center group gap-4"
												>
													<div class="flex-1">
														<div class="flex flex-row items-baseline gap-2 mb-1">
															<CardTitle>{itemConfig.name}</CardTitle>
															<a
																class="text-sm text-gray-600 font-medium hover:underline"
																href={docsURL(itemConfig.name, payloadKey)}
																target="_blank"
																rel="noopener noreferrer"
																onClick={(e) => e.stopPropagation()}
															>
																{payloadKey}
															</a>
														</div>
													</div>
													<IconTablerChevronUp class="ml-auto ui-group-closed:rotate-180" />
												</Accordion.Trigger>
											</Accordion.Header>
											<Accordion.Content
												as="ul"
												class="space-y-3 px-6 py-4 transition-all animate-accordion-up data-[expanded]:animate-accordion-down overflow-hidden"
												onFocusIn={(e: FocusEvent) => e.stopPropagation()}
											>
												<For each={Object.entries(itemConfig.policies)}>
													{([key, policy]) => {
														const id = createUniqueId();

														return (
															<li>
																<div class="flex flex-row items-center gap-1.5 relative">
																	{value.data[key] !== undefined && (
																		<button
																			type="button"
																			onClick={() => setData(key, undefined!)}
																			class="w-2 h-2 bg-brand rounded-full absolute -left-4 top-1.5 ring-brand ring-offset-2 focus-visible:ring-2 transition-shadow outline-none"
																		/>
																	)}
																	<Show when={policy.format === "bool"}>
																		<Checkbox
																			id={id}
																			checked={
																				(value.data[key] as boolean) ?? false
																			}
																			onChange={(checked) =>
																				setData(key, checked)
																			}
																		/>
																	</Show>
																	<label
																		class="font-medium text-sm"
																		for={
																			policy.format === "bool"
																				? `${id}-input`
																				: id
																		}
																	>
																		{policy.title ?? policy.name}
																	</label>
																	<a
																		class="text-sm text-neutral-500 hover:underline"
																		href={`${docsURL(
																			itemConfig.name,
																			payloadKey,
																		)}#${key.replace(/\//g, "").toLowerCase()}`}
																		target="_blank"
																		rel="noopener noreferrer"
																	>
																		{key}
																	</a>
																</div>
																{policy.description && (
																	<p class="text-sm text-neutral-500">
																		{policy.description}
																	</p>
																)}
																<Switch
																	fallback={
																		policy.format !== "bool" &&
																		`unimplemented format (${policy.format})`
																	}
																>
																	<Match
																		when={policy.format === "int" && policy}
																		keyed
																	>
																		{(policy) => (
																			<Switch
																				fallback={
																					<NumberInput
																						class="mt-2"
																						defaultValue={policy.defaultValue}
																						value={
																							(value.data[key] as number) ??
																							policy.defaultValue
																						}
																						onChange={(value) =>
																							setData(key, value)
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
																						policy.allowedValues &&
																						policy.allowedValues.valueType ===
																							"enum" &&
																						policy.allowedValues
																					}
																				>
																					{(allowedValues) => {
																						const options = createMemo(() =>
																							Object.entries(
																								allowedValues().enum,
																							).map(([value, config]) => ({
																								...config,
																								value: Number(value),
																							})),
																						);

																						const selectValue = createMemo(
																							() =>
																								options().find(
																									(o) =>
																										o.value === value.data[key],
																								) ?? null,
																						);

																						type Option = ReturnType<
																							typeof options
																						>[number];

																						return (
																							<Select<Option | null>
																								class="mt-2"
																								options={options()}
																								multiple={false}
																								optionValue="value"
																								optionTextValue="description"
																								optionDisabled={() => false}
																								placeholder="No Value"
																								itemComponent={(props) => (
																									<SelectItem item={props.item}>
																										{
																											props.item.rawValue
																												?.description
																										}
																									</SelectItem>
																								)}
																								value={selectValue()}
																								onChange={(option) => {
																									if (option)
																										setData(key, option.value);
																									else setData(key, undefined!);
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
																						policy.allowedValues &&
																						policy.allowedValues.valueType ===
																							"range" &&
																						policy.allowedValues
																					}
																				>
																					{(allowedValues) => {
																						return (
																							<NumberInput
																								class="mt-2"
																								minValue={allowedValues().min}
																								maxValue={allowedValues().max}
																								defaultValue={
																									policy.defaultValue
																								}
																								value={
																									(value.data[key] as number) ??
																									policy.defaultValue
																								}
																								onChange={(value) =>
																									setData(key, value)
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
																		when={policy.format === "string" && policy}
																	>
																		<Input
																			class="mt-2"
																			value={value.data[key] as string}
																			onChange={(e) =>
																				setData(key, e.currentTarget.value)
																			}
																		/>
																	</Match>
																</Switch>
															</li>
														);
													}}
												</For>
											</Accordion.Content>
										</Accordion.Item>
									);
								}}
							</Show>
						);
					}}
				</For>
			</Accordion>
		</>
	);
}

function CSPS(props: { csps?: Record<string, WindowsCSP> }) {
	const controller = useController();

	const [search, setSearch] = createSignal("");

	const tokenisedCSPs = createMemo(() => {
		const csps = props.csps || {};
		const tokenisedPayloads: Record<string, string[]> = {};

		for (const [key, csp] of Object.entries(csps)) {
			const tokens = [key, csp.name].map((token) => token?.toLowerCase());

			tokenisedPayloads[key] = tokens;
		}

		return tokenisedPayloads;
	});

	const sortedCSPs = createMemo(() =>
		Object.entries(props.csps || {}).sort(([, a], [, b]) =>
			a.name.localeCompare(b.name),
		),
	);

	const filteredCSPs = createMemo(() => {
		if (search() === "") return sortedCSPs();

		const searchValueTokens = search().toLowerCase().split(" ").filter(Boolean);

		return sortedCSPs().filter(([key]) =>
			searchValueTokens.every((searchToken) =>
				tokenisedCSPs()[key]!.some((token) => token.includes(searchToken)),
			),
		);
	});

	return (
		<div class="flex-1 max-w-xl flex sticky top-12 flex-col max-h-[calc(100vh-3rem)] overflow-hidden">
			<div class="m-2">
				<Input
					class="z-20"
					placeholder="Search Configurations"
					value={search()}
					onInput={(e) => setSearch(e.target.value)}
				/>
			</div>
			<ul class="rounded-lg overflow-y-auto flex-1">
				<For each={filteredCSPs()}>
					{([uri, value]) => {
						const id = createUniqueId();

						return (
							<li class="flex flex-row items-center gap-4 px-4 py-1">
								<Checkbox
									disabled={!controller.state.windows}
									id={id}
									onChange={(value) => {
										if (value)
											controller.setState("windows", uri, (k) => ({
												enabled: value,
												open: true,
												data: k?.data ?? {},
											}));
										else controller.setState("windows", uri, "enabled", false);
									}}
								/>
								<div class="overflow-hidden flex flex-col items-stretch flex-1">
									<label for={`${id}-input`} class="font-medium">
										{value.name}
									</label>
									<a
										class="block text-sm text-neutral-500 overflow-y-auto scrollbar-none hover:underline"
										href={docsURL(value.name, uri)}
										target="_blank"
										rel="noopener noreferrer"
									>
										{uri}
									</a>
								</div>
							</li>
						);
					}}
				</For>
			</ul>
		</div>
	);
}
