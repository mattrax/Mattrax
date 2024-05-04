import { A } from "@solidjs/router";
import { createTimeAgo } from "@solid-primitives/date";
import { As } from "@kobalte/core";

import {
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	Textarea,
} from "@mattrax/ui";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import { useDevice } from "./Context";
import { trpc } from "~/lib";
import { toast } from "solid-sonner";
import { Item } from "~/components/Item";
import { withDependantQueries } from "@mattrax/trpc-server-function/client";

// TODO: Rename device
// TODO: Rotate filevault keys
// TODO: Disable activation lock

export default function Page() {
	const device = useDevice();

	const triggerAction = trpc.device.action.createMutation(() => ({
		onSuccess: (_, data) =>
			toast.success(`Triggered ${data.action} successfully`),
		...withDependantQueries(device.query),
	}));

	const [lastSeen] = createTimeAgo(device().lastSynced);
	const [enrolledAt] = createTimeAgo(device().enrolledAt);
	const storage = () => {
		const d = device();
		let result = "";
		if (d.freeStorageSpaceInBytes)
			result += `${d.freeStorageSpaceInBytes / 1e9} GB used`;

		if (d.totalStorageSpaceInBytes) {
			if (d.freeStorageSpaceInBytes) result += " / ";
			result += `${d.totalStorageSpaceInBytes / 1e9} GB available`;
		}
		return result;
	};

	return (
		<PageLayout
			heading={
				<div class="flex justify-between w-full">
					<PageLayoutHeading>Overview</PageLayoutHeading>

					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							{/* // TODO: Make this button's UI indicate dropdown menu not button */}
							<As component={Button}>Actions</As>
						</DropdownMenuTrigger>
						<DropdownMenuContent>
							<DropdownMenuItem
								disabled={triggerAction.isPending}
								onClick={() =>
									triggerAction.mutate({
										action: "sync",
										deviceId: device().id,
									})
								}
							>
								Sync
							</DropdownMenuItem>
							<DropdownMenuItem
								disabled={triggerAction.isPending}
								onClick={() =>
									triggerAction.mutate({
										action: "restart",
										deviceId: device().id,
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
										deviceId: device().id,
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
										deviceId: device().id,
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
										deviceId: device().id,
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
			<h2 class="text-bold text-xl">General:</h2>
			{/* // TODO: Enrollment type (supervised, DEP, Windows Azure, etc) */}
			{/* // TODO: User approved enrollment */}
			<Item
				label="Owner"
				data={
					<A href={`../../users/${device().ownerId}`} class="hover:underline">
						{device().ownerName}
					</A>
				}
			/>
			{/* // TODO: External link to Entra ID portal??? */}
			{device().azureADDeviceId && (
				<Item label="Entra Device ID" data={device().azureADDeviceId} />
			)}
			{/* // TODO: Tooltip on dates with actual value */}
			<Item label="Last Seen" data={lastSeen()} />
			<Item label="Enrolled At" data={enrolledAt()} />
			{/* // TODO: Allow saving changes to notes */}
			<Item
				label="Notes"
				data={<Textarea disabled>{device().description}</Textarea>}
			/>

			<h2 class="text-bold text-xl">Hardware:</h2>
			<Item label="Serial Number" data={device().serialNumber} />
			<Item label="Device Manufacturer" data={device().manufacturer} />
			<Item label="Device Model" data={device().model} />
			<Item
				label="Processor"
				data={<p class="text-muted-foreground opacity-70">Coming soon</p>}
			/>
			<Item
				label="RAM"
				data={<p class="text-muted-foreground opacity-70">Coming soon</p>}
			/>
			{/* // TODO: Render storage as a progress bar */}
			<Item label="Storage" data={storage()} />
			<Item
				label="Battery Condition"
				data={<p class="text-muted-foreground opacity-70">Coming soon</p>}
			/>

			<h2 class="text-bold text-xl">Software:</h2>
			<Item label="Operating System" data={device().os} />
			<Item
				label="OS version"
				data={<p class="text-muted-foreground opacity-70">Coming soon</p>}
			/>
			<Item
				label="OS uptime"
				data={<p class="text-muted-foreground opacity-70">Coming soon</p>}
			/>
			<Item
				label="Disk encryption"
				data={<p class="text-muted-foreground opacity-70">Coming soon</p>}
			/>

			<h2 class="text-bold text-xl">Network:</h2>
			<Item
				label="Private IP"
				data={<p class="text-muted-foreground opacity-70">Coming soon</p>}
			/>
			{/* // TODO: Show approximate location of public IP */}
			<Item
				label="Public IP"
				data={<p class="text-muted-foreground opacity-70">Coming soon</p>}
			/>
			<Item
				label="MAC addresses"
				data={<p class="text-muted-foreground opacity-70">Coming soon</p>}
			/>

			{/* Supervised
			Encrypted
			Jailbroken
			Bootstrap token escrowed */}
		</PageLayout>
	);
}
