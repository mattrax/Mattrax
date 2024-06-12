import { createTimeAgo } from "@solid-primitives/date";
import { A } from "@solidjs/router";

import { withDependantQueries } from "@mattrax/trpc-server-function/client";
import {
	Button,
	DescriptionDetails,
	DescriptionList,
	DescriptionTerm,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	Textarea,
} from "@mattrax/ui";
import { type JSX, Show, Suspense } from "solid-js";
import { toast } from "solid-sonner";
import { trpc } from "~/lib";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import { useDevice, useDeviceId } from "../ctx";

// TODO: Rename device
// TODO: Rotate filevault keys
// TODO: Disable activation lock

export default function Page() {
	const deviceId = useDeviceId();
	const device = useDevice();

	const triggerAction = trpc.device.action.createMutation(() => ({
		onSuccess: (_, data) =>
			toast.success(`Triggered ${data.action} successfully`),
		...withDependantQueries(device),
	}));

	return (
		<PageLayout
			heading={
				<div class="flex justify-between w-full">
					<PageLayoutHeading>Overview</PageLayoutHeading>

					<DropdownMenu>
						{/* // TODO: Make this button's UI indicate dropdown menu not button */}
						<DropdownMenuTrigger as={Button}>Actions</DropdownMenuTrigger>
						<DropdownMenuContent>
							<DropdownMenuItem
								disabled={triggerAction.isPending}
								onClick={() =>
									triggerAction.mutate({
										action: "sync",
										deviceId: deviceId(),
									})
								}
							>
								Sync
							</DropdownMenuItem>
							{/* TODO: Handle MDM permissions here */}
							<DropdownMenuItem
								disabled={triggerAction.isPending}
								onClick={() =>
									triggerAction.mutate({
										action: "restart",
										deviceId: deviceId(),
									})
								}
							>
								Restart
							</DropdownMenuItem>
							<DropdownMenuItem
								disabled={triggerAction.isPending}
								onClick={() =>
									triggerAction.mutate({
										action: "shutdown",
										deviceId: deviceId(),
									})
								}
								class="text-red-500"
							>
								Shutdown
							</DropdownMenuItem>
							<DropdownMenuItem
								disabled={triggerAction.isPending}
								onClick={() =>
									triggerAction.mutate({
										action: "lost",
										deviceId: deviceId(),
									})
								}
								class="text-red-500"
							>
								Lost Mode
							</DropdownMenuItem>
							{/* <DropdownMenuItem disabled={triggerAction.isPending} onClick={() => alert("TODO")} class="text-red-500">
								Clear passcode
							</DropdownMenuItem> */}
							<DropdownMenuItem
								disabled={triggerAction.isPending}
								onClick={() =>
									triggerAction.mutate({
										action: "wipe",
										deviceId: deviceId(),
									})
								}
								class="text-red-500"
							>
								Wipe
							</DropdownMenuItem>
							<DropdownMenuItem
								disabled={triggerAction.isPending}
								onClick={() => alert("TODO: Confirmation then unenroll device")}
								class="text-red-500"
							>
								Retire
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			}
		>
			<DescriptionList>
				<h2 class="text-bold text-xl">General:</h2>

				{/* // TODO: Enrollment type (supervised, DEP, Windows Azure, etc) */}
				{/* // TODO: User approved enrollment */}

				<DescriptionTerm>Owner</DescriptionTerm>
				<Details>
					{() => {
						return (
							<A
								href={`../../users/${device.data?.ownerId}`}
								class="hover:underline"
							>
								{device.data?.ownerName}
							</A>
						);
					}}
				</Details>

				<Show when={device.data?.azureADDeviceId}>
					{(azureAdId) => (
						<>
							<DescriptionTerm>Entra Device ID</DescriptionTerm>
							{/* // TODO: External link to Entra ID portal??? */}
							<Details>{azureAdId}</Details>
						</>
					)}
				</Show>

				{/* // TODO: Tooltip on dates with actual value */}
				<DescriptionTerm>Last Seen</DescriptionTerm>
				<Details>
					{() => {
						if (!device.data?.lastSynced) return "Never";
						const [lastSeen] = createTimeAgo(device.data?.lastSynced);
						return lastSeen();
					}}
				</Details>

				<DescriptionTerm>Enrolled At</DescriptionTerm>
				<Details>
					{() => {
						if (!device.data?.enrolledAt) return "Never";
						const [enrolledAt] = createTimeAgo(device.data?.enrolledAt);
						return enrolledAt();
					}}
				</Details>

				<DescriptionTerm>Notes</DescriptionTerm>
				<Details>
					{() => (
						<Textarea disabled={device.isPending && true}>
							{device.data?.description}
						</Textarea>
					)}
				</Details>

				<h2 class="text-bold text-xl">Hardware:</h2>

				<DescriptionTerm>Serial Number</DescriptionTerm>
				<Details>{() => device.data?.serialNumber}</Details>

				<DescriptionTerm>Device Manufacturer</DescriptionTerm>
				<Details>{() => device.data?.manufacturer}</Details>

				<DescriptionTerm>Device Model</DescriptionTerm>
				<Details>{() => device.data?.model}</Details>

				<DescriptionTerm>Processor</DescriptionTerm>
				<Details>
					{() => <p class="text-muted-foreground opacity-70">Coming soon</p>}
				</Details>
				<DescriptionTerm>RAM</DescriptionTerm>
				<Details>
					{() => <p class="text-muted-foreground opacity-70">Coming soon</p>}
				</Details>
				{/* // TODO: Render storage as a progress bar */}
				<DescriptionTerm>Storage</DescriptionTerm>
				<Details>
					{() => {
						if (!device.data) return "...";
						const d = device.data;
						let result = "";
						if (d.freeStorageSpaceInBytes)
							result += `${d.freeStorageSpaceInBytes / 1e9} GB used`;

						if (d.totalStorageSpaceInBytes) {
							if (d.freeStorageSpaceInBytes) result += " / ";
							result += `${d.totalStorageSpaceInBytes / 1e9} GB available`;
						}
						return result;
					}}
				</Details>
				<DescriptionTerm>Battery Condition</DescriptionTerm>
				<Details>
					{() => <p class="text-muted-foreground opacity-70">Coming soon</p>}
				</Details>

				<h2 class="text-bold text-xl">Software:</h2>
				{/* // TODO: Show a logo */}
				<DescriptionTerm>Operating System</DescriptionTerm>
				<Details>{() => device.data?.os}</Details>
				<DescriptionTerm>Operating System Version</DescriptionTerm>
				<Details>
					{() => <p class="text-muted-foreground opacity-70">Coming soon</p>}
				</Details>
				<DescriptionTerm>Uptime</DescriptionTerm>
				<Details>
					{() => <p class="text-muted-foreground opacity-70">Coming soon</p>}
				</Details>
				<DescriptionTerm>Disk Encryption</DescriptionTerm>
				<Details>
					{() => <p class="text-muted-foreground opacity-70">Coming soon</p>}
				</Details>

				<h2 class="text-bold text-xl">Network:</h2>
				<DescriptionTerm>Private IP</DescriptionTerm>
				<Details>
					{() => <p class="text-muted-foreground opacity-70">Coming soon</p>}
				</Details>
				<h2 class="text-bold text-xl">Network:</h2>
				{/* // TODO: Show approximate location of public IP */}
				<DescriptionTerm>Public IP</DescriptionTerm>
				<Details>
					{() => <p class="text-muted-foreground opacity-70">Coming soon</p>}
				</Details>
				<DescriptionTerm>MAC addresses</DescriptionTerm>
				<Details>
					{() => <p class="text-muted-foreground opacity-70">Coming soon</p>}
				</Details>

				{/* Supervised
				Encrypted
				Jailbroken
				Bootstrap token escrowed */}
			</DescriptionList>
		</PageLayout>
	);
}

const Details = (props: { children: () => JSX.Element }) => {
	return (
		<DescriptionDetails class="flex items-center space-x-2">
			<Suspense
				fallback={
					<div class="flex items-center">
						<div class="w-44 h-6 bg-neutral-200 animate-pulse rounded-full" />
					</div>
				}
			>
				{props.children()}
			</Suspense>
		</DescriptionDetails>
	);
};

// function Item(props: {
// 	label: string;
// 	data: () => JSX.Element;
// }) {
// 	// TODO: Make this not look like ass
// 	return (
// 		<div class="flex flex-col space-y-1.5">
// 			<Label>{props.label}:</Label>
// 			<Suspense
// 										fallback={
// 											<div class="w-24 h-4 rounded-full bg-neutral-200 animate-pulse" />
// 										}
// 									>
// 			<Show when>
// 				{(_) => {
// 					const data = props.data();

// 					return (

// 							{/* Avoid nested p tags */}typeof data === "string" ? (
// 								<p class="py-1 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">

// 										{data}

// 								</p>
// 							) : (
// 								<div class="py-1 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">

// 										{data}

// 								</div>
// 							)

// 					);
// 				}}
// 			</Show>
// 			</Suspense>
// 		</div>
// 	);
// }
