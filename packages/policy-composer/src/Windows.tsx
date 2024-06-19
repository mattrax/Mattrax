import { Accordion } from "@kobalte/core/accordion";
import type {
	WindowsCSP,
	WindowsDDFNode,
} from "@mattrax/configuration-schemas/windows";
import type { PolicyData } from "@mattrax/policy";
import {
	Button,
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
	Index,
	Match,
	Show,
	Switch,
	batch,
	createContext,
	createMemo,
	createSignal,
	createUniqueId,
	useContext,
} from "solid-js";
import { type SetStoreFunction, createStore, produce } from "solid-js/store";

import { useController } from "./Context";
import { Menubar } from "./Menubar";

function cspDocsURL(name: string, path: string) {
	const BASE_URL =
		"https://learn.microsoft.com/en-gb/windows/client-management/mdm";

	const sanitisedName = name.toLowerCase().replace("_", "-");

	let hash: string | undefined;
	if (path.startsWith("./User")) {
		hash = "user";
	} else if (path.startsWith("./Device")) {
		hash = "device";
	}

	const suffix = hash ? `#${hash}` : "";

	if (path.includes("/Policy/"))
		return `${BASE_URL}/policy-csp-${sanitisedName}${suffix}`;

	return `${BASE_URL}/${sanitisedName}-csp${suffix}`;
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
						const csp = () => props.csps![payloadKey];

						const when = () => {
							const c = csp();
							if (c && value) return { csp: c, value };
						};

						return (
							<Show when={when()} keyed>
								{({ csp, value }) => {
									const [, setData] = createStore(value.data);

									return (
										<NodeEditorCSPContext.Provider value={{ csp }}>
											<Accordion.Item
												value={payloadKey}
												as="li"
												class="border-b border-gray-200"
											>
												<Accordion.Header class="shadow sticky top-12 bg-white z-10">
													<Accordion.Trigger
														as="div"
														class="px-4 py-4 flex flex-row justify-start items-center group gap-2"
													>
														<IconTablerChevronUp class="ui-group-closed:rotate-180 transition-transform" />
														<CardTitle>{csp.name}</CardTitle>
														<a
															class="text-sm text-gray-600 font-medium hover:underline"
															href={cspDocsURL(csp.name, payloadKey)}
															target="_blank"
															rel="noopener noreferrer"
															onClick={(e) => e.stopPropagation()}
														>
															{payloadKey}
														</a>
													</Accordion.Trigger>
												</Accordion.Header>
												<Accordion.Content
													as="ul"
													class="space-y-4 px-6 py-4 transition-all ui-closed:animate-accordion-up ui-expanded:animate-accordion-down overflow-hidden"
													onFocusIn={(e: FocusEvent) => e.stopPropagation()}
												>
													<For
														each={Object.entries(csp.nodes).filter(
															([key, node]) => {
																if (!controller.state.filter) return true;

																const path = `${key}${
																	node.dynamic ? `/{${node.dynamic}}` : ""
																}`;
																return value.data[path] !== undefined;
															},
														)}
														fallback={
															controller.state.filter && (
																<span class="text-gray-500">
																	No Nodes Active
																</span>
															)
														}
													>
														{([key, node]) => {
															const path = () =>
																`${key}${
																	node.dynamic ? `/{${node.dynamic}}` : ""
																}`;

															const data = () => value.data[path()];

															return (
																<li>
																	<NodeEditor
																		path={path()}
																		data={data()}
																		setData={setData}
																		node={node}
																		payloadKey={payloadKey}
																		fullNodePath={path()}
																	/>
																</li>
															);
														}}
													</For>
												</Accordion.Content>
											</Accordion.Item>
										</NodeEditorCSPContext.Provider>
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
		Object.entries(props.csps || {})
			.filter(([uri]) => {
				if (!controller.state.filter) return true;

				return controller.state.windows?.[uri]?.enabled ?? false;
			})
			.sort(([, a], [, b]) => a.name.localeCompare(b.name)),
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
			<Menubar />

			<div class="mx-2 mt-1 mb-2">
				<Input
					class="z-20"
					placeholder="Search Configurations"
					value={search()}
					onInput={(e) => setSearch(e.target.value)}
				/>
			</div>
			<ul class="rounded-lg overflow-y-auto flex-1">
				<For each={filteredCSPs()}>
					{([uri, csp]) => {
						const id = createUniqueId();

						return (
							<li class="flex flex-row items-center gap-4 px-4 py-1">
								<Checkbox
									disabled={!controller.state.windows}
									id={id}
									checked={controller.state.windows?.[uri]?.enabled ?? false}
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
										{csp.name}
									</label>
									<a
										class="block text-sm text-neutral-500 overflow-y-auto scrollbar-none hover:underline"
										href={cspDocsURL(csp.name, uri)}
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

const NodeEditorCSPContext = createContext<{
	csp: WindowsCSP;
}>(null!);

function NodeEditor(props: {
	path: string;
	data?: PolicyData["windows"][string][string];
	setData: SetStoreFunction<PolicyData["windows"][string]>;
	node: WindowsDDFNode;
	payloadKey: string;
	fullNodePath: string;
}) {
	const controller = useController();
	const id = createUniqueId();
	const cspCtx = useContext(NodeEditorCSPContext)!;

	const node = () => props.node;

	return (
		<>
			<div class="flex flex-row items-center gap-1.5 relative">
				{props.data !== undefined && (
					<button
						type="button"
						onClick={() => props.setData(props.path, undefined!)}
						class="w-2 h-2 bg-brand rounded-full absolute -left-4 top-1.5 ring-brand ring-offset-2 focus-visible:ring-2 transition-shadow outline-none"
					/>
				)}
				<Show when={node().format === "bool"}>
					<Checkbox
						id={id}
						checked={(!!props.data as boolean) ?? false}
						onChange={(checked) => props.setData(props.path, checked)}
					/>
				</Show>
				<label
					class="font-medium text-sm"
					for={node().format === "bool" ? `${id}-input` : id}
				>
					{node().title ?? node().name}
				</label>
				<a
					class="text-sm text-neutral-500 hover:underline"
					href={`${cspDocsURL(
						cspCtx.csp.name,
						props.payloadKey,
					)}${props.fullNodePath.replace(/[\/\{\}]/g, "").toLowerCase()}`}
					target="_blank"
					rel="noopener noreferrer"
				>
					{props.path}
				</a>
			</div>
			{node().description && (
				<p class="text-sm text-neutral-500">{node().description}</p>
			)}
			<Switch
				fallback={
					node().format !== "bool" && `unimplemented format (${node().format})`
				}
			>
				<Match
					when={(() => {
						const n = node();
						return n.format === "int" && n;
					})()}
					keyed
				>
					{(policy) => (
						<Switch
							fallback={
								<NumberInput
									class="mt-2"
									defaultValue={policy.defaultValue}
									value={(props.data as number) ?? policy.defaultValue}
									onChange={(value) => props.setData(props.path, value)}
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
									policy.allowedValues.valueType === "enum" &&
									policy.allowedValues
								}
							>
								{(allowedValues) => {
									const options = createMemo(() =>
										Object.entries(allowedValues().enum).map(
											([value, config]) => ({
												...config,
												value: Number(value),
											}),
										),
									);

									const selectValue = createMemo(
										() => options().find((o) => o.value === props.data) ?? null,
									);

									type Option = ReturnType<typeof options>[number];

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
													{props.item.rawValue?.description}
												</SelectItem>
											)}
											value={selectValue()}
											onChange={(option) => {
												if (option) props.setData(props.path, option.value);
												else props.setData(props.path, undefined!);
											}}
										>
											<SelectTrigger>
												<SelectValue<Option>>
													{(state) => <>{state.selectedOption().description}</>}
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
									policy.allowedValues.valueType === "range" &&
									policy.allowedValues
								}
							>
								{(allowedValues) => {
									return (
										<NumberInput
											class="mt-2"
											minValue={allowedValues().min}
											maxValue={allowedValues().max}
											defaultValue={policy.defaultValue}
											value={(props.data as number) ?? policy.defaultValue}
											onChange={(value) => props.setData(props.path, value)}
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
				<Match when={props.node.format === "string" && props.node}>
					<Switch
						fallback={
							<Input
								class="mt-2"
								value={(props.data as string) ?? ""}
								onChange={(e) =>
									props.setData(props.path, e.currentTarget.value)
								}
							/>
						}
					>
						<Match when={props.node.dynamic}>
							{(_) => {
								const [value, setValue] = createSignal("");

								return (
									<>
										<div class="flex flex-row gap-2 items-center mt-2">
											<Input
												value={value()}
												onChange={(e) => setValue(e.currentTarget.value)}
											/>
											<Button
												class="shrink-0"
												onClick={() => {
													props.setData(
														produce((d) => {
															d[props.path] ??= [] as any;

															(d[props.path] as any as any[]).unshift(value());
														}),
													);
												}}
											>
												Add Node
											</Button>
										</div>

										<ul class="border border-gray-3000 rounded overflow-hidden mt-2 p-2 gap-2 flex flex-col">
											<Show
												when={props.data as any as string[]}
												fallback={
													<div class="text-center text-gray-500 text-sm">
														No Items
													</div>
												}
											>
												{(values) => (
													<Index each={values()}>
														{(value, index) => (
															<li class="flex flex-row gap-2">
																<Input value={value()} />
																<Button
																	class="shrink-0"
																	onClick={() => {
																		batch(() => {
																			props.setData(
																				produce((d) => {
																					const a = d[
																						props.path
																					] as any as any[];
																					a.splice(index, 1);

																					if (a.length === 0)
																						delete d[props.path];
																				}),
																			);
																		});
																	}}
																>
																	Remove
																</Button>
															</li>
														)}
													</Index>
												)}
											</Show>
										</ul>
									</>
								);
							}}
						</Match>
					</Switch>
				</Match>
				<Match when={props.node.format === "node" && props.node}>
					{(node) => {
						const [nodeValue, setNodeValue] = createSignal("");

						const [expanded, setExpanded] = createSignal(
							Object.keys(props.data ?? {}),
						);

						return (
							<>
								<div class="flex flex-row gap-2 my-2">
									<Input
										placeholder={node().title ?? ""}
										value={nodeValue()}
										onInput={(e) => setNodeValue(e.target.value)}
									/>
									<Button
										class="shrink-0"
										onClick={() => {
											batch(() => {
												props.setData(props.path, { [nodeValue()]: {} });
												setExpanded((e) => [...e, nodeValue()]);

												setNodeValue("");
											});
										}}
									>
										Add Node
									</Button>
								</div>
								<Accordion
									as="ul"
									class="border border-gray-3000 rounded divide-y divide-gray-300 overflow-hidden"
									value={expanded()}
									onChange={setExpanded}
									multiple
								>
									<For
										each={Object.entries(
											(props.data as Record<string, any>) ?? {},
										)}
										fallback={
											<div class="py-2 text-center text-gray-500 text-sm">
												No Items
											</div>
										}
									>
										{([name, data]) => (
											<Accordion.Item as="li" value={name}>
												<Accordion.Header class="flex flex-row justify-between items-center p-2 shadow gap-2">
													<Accordion.Trigger class="group p-2">
														<IconTablerChevronUp class="ui-group-closed:rotate-180 transition-transform text-base" />
													</Accordion.Trigger>
													<Input value={name} />
													<Button
														class="shrink-0"
														onClick={() => {
															batch(() => {
																props.setData(props.path, name, undefined!);

																if (Object.keys(props.data ?? {}).length === 0)
																	props.setData(props.path, undefined!);
															});
														}}
													>
														Remove
													</Button>
												</Accordion.Header>
												<Accordion.Content
													as="ul"
													class="p-6 flex flex-col gap-4 transition-all ui-closed:animate-accordion-up ui-expanded:animate-accordion-down"
												>
													<For
														each={Object.entries(node().nodes).filter(
															([key, node]) => {
																if (!controller.state.filter) return true;

																const path = `${key}${
																	node.dynamic ? `/{${node.dynamic}}` : ""
																}`;
																return data[path] !== undefined;
															},
														)}
													>
														{([key, node]) => {
															const path = () =>
																`${key}${
																	node.dynamic ? `/{${node.dynamic}}` : ""
																}`;

															return (
																<li>
																	<NodeEditor
																		path={path()}
																		node={node}
																		data={data[path()]}
																		payloadKey={`${props.payloadKey}${props.path}`}
																		setData={(...args: any[]) => {
																			props.setData(
																				props.path,
																				name,
																				// @ts-ignore
																				...args,
																			);
																		}}
																		fullNodePath={`${
																			props.fullNodePath
																		}${path()}`}
																	/>
																</li>
															);
														}}
													</For>
												</Accordion.Content>
											</Accordion.Item>
										)}
									</For>
								</Accordion>
							</>
						);
					}}
				</Match>
			</Switch>
		</>
	);
}
