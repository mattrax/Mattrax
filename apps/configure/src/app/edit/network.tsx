import { For, createMemo, createSignal } from "solid-js";
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
import { produce } from "solid-js/store";

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
						const [isEditable, setIsEditable] = createSignal(true);

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
													file.setFile(
														"restrictions",
														i(),
														"ssid",
														event.currentTarget.textContent,
													);
												}
											}}
											onBlur={(event) => {
												file.setFile(
													"restrictions",
													i(),
													"ssid",
													event.currentTarget.textContent,
												);
											}}
										>
											{restriction.ssid}
										</CardTitle>
									</div>

									<Button
										variant="destructive"
										onClick={() => {
											file.setFile(
												"restrictions",
												file.file.restrictions.filter(
													(_, index) => index !== i(),
												),
											);
										}}
									>
										Delete
									</Button>
								</CardHeader>
								<CardContent>
									{/* TODO: Select type of authentication before showing this */}
									<Label>Preshared Key</Label>
									<Input
										name="preshared_key"
										value={file.file.restrictions[i()].security.preshared_key}
										onInput={(event) =>
											file.setFile("restrictions", i(), "security", {
												type: "wpa2",
												preshared_key: event.currentTarget.value,
											})
										}
									/>
								</CardContent>
							</Card>
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
