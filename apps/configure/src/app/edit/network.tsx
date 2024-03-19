import { For, Match, Switch, createMemo, createSignal } from "solid-js";
import {
	Button,
	Card,
	CardContent,
	CardHeader,
	CardTitle,
	Input,
	Label,
} from "@mattrax/ui";
import { type WiFiRestriction, useFile } from "~/file";

export default function Component() {
	const file = useFile();

	const networkRestrictions = createMemo(
		() =>
			file.file.restrictions.filter(
				(r) => r.type === "wifi",
			) as WiFiRestriction[], // TODO: Can we type narrow so we don't need an explicit cast?
	);

	return (
		<div class="flex flex-col space-y-4 w-full">
			<h1 class="text-3xl">Network</h1>
			<div class="flex flex-col space-y-4 w-full">
				<For each={networkRestrictions()}>
					{(restriction, i) => {
						return (
							<Switch>
								<Match
									when={
										restriction.type === "wifi" &&
										restriction.network_type === "basic" &&
										restriction
									}
								>
									{(restriction) => {
										const [isEditable, setIsEditable] = createSignal(true);

										function setSsid(ssid: string) {
											file.setFile("restrictions", i(), {
												...restriction(),
												ssid,
											});
										}

										return (
											<Card class="w-full">
												<CardHeader class="flex-row justify-between">
													<div>
														<h2>SSID:</h2>
														<CardTitle
															contentEditable={isEditable()}
															onClick={() => setIsEditable(true)}
															onKeyPress={(event) => {
																if (event.key === "Enter") {
																	setIsEditable(false);
																	setSsid(
																		event.currentTarget.textContent ?? "",
																	);
																}
															}}
															onBlur={(event) => {
																setSsid(event.currentTarget.textContent ?? "");
															}}
														>
															{restriction().ssid}
														</CardTitle>
													</div>

													<Button
														variant="destructive"
														onClick={() => {
															file.setFile("restrictions", i(), undefined!);
														}}
													>
														Delete
													</Button>
												</CardHeader>
												<CardContent>
													<Switch>
														<Match
															when={(() => {
																const r = restriction();
																return r.security.type === "wpa2" && r.security;
															})()}
														>
															{(security) => (
																<>
																	{/* TODO: Select type of authentication before showing this */}
																	<Label>Preshared Key</Label>
																	<Input
																		name="preshared_key"
																		value={security().preshared_key}
																		onInput={(event) =>
																			file.setFile("restrictions", i(), {
																				...restriction,
																				security: {
																					...security(),
																					preshared_key:
																						event.currentTarget.value,
																				},
																			})
																		}
																	/>
																</>
															)}
														</Match>
													</Switch>
												</CardContent>
											</Card>
										);
									}}
								</Match>
							</Switch>
						);
					}}
				</For>
			</div>
			{/* TODO: make this look good, centered plus button? */}
			<Button
				onClick={() => {
					file.setFile("restrictions", [
						...file.file.restrictions,
						// TODO: Don't put this into the file until it's valid???
						{
							type: "wifi",
							network_type: "basic",
							ssid: "My Cool WiFi",
							security: {
								type: "open",
							},
						},
					]);
				}}
			>
				New Network
			</Button>

			{/* TODO: Dns + vpn config maybe?? */}
		</div>
	);
}
