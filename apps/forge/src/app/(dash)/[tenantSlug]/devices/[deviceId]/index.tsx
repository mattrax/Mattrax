import { JSX } from "solid-js";
import { A } from "@solidjs/router";
import {
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	Label,
} from "~/components/ui";
import { PageLayout, PageLayoutHeading } from "../../PageLayout";
import { useDevice } from "../[deviceId]";
import { createTimeAgo } from "@solid-primitives/date";
import { As } from "@kobalte/core";
import { trpc } from "~/lib";
import { useTenant } from "~/app/(dash)/TenantContext";

export default function Page() {
	const device = useDevice();

	const syncDevice = trpc.device.sync.useMutation(() => ({
		onSuccess: () => device.query.refetch(),
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

	const isDropdownDisabled = () => syncDevice.isPending;

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
								disabled={isDropdownDisabled()}
								onClick={() =>
									syncDevice.mutate({
										deviceId: device().id,
									})
								}
							>
								Sync
							</DropdownMenuItem>
							<DropdownMenuItem
								disabled={isDropdownDisabled()}
								onClick={() => alert("TODO: Confirmation then lock device")}
								class="text-red-500"
							>
								Lost Mode
							</DropdownMenuItem>
							{/* <DropdownMenuItem disabled={isDropdownDisabled()} onClick={() => alert("TODO")} class="text-red-500">
								Clear passcode
							</DropdownMenuItem> */}
							<DropdownMenuItem
								disabled={isDropdownDisabled()}
								onClick={() => alert("TODO: Confirmation then wipe device")}
								class="text-red-500"
							>
								Wipe
							</DropdownMenuItem>
							<DropdownMenuItem
								disabled={isDropdownDisabled()}
								onClick={() => alert("TODO: Confirmation then unenroll device")}
								class="text-red-500"
							>
								Remove
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			}
		>
			<h2 class="text-bold text-xl">General:</h2>
			{/* // TODO: Enrollment type (supervised, DEP, Windows Azure, etc) */}
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
			<Item label="Operating System" data={device().operatingSystem} />
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
		</PageLayout>
	);
}

function Item(props: {
	label: string;
	data: JSX.Element;
}) {
	// TODO: Make this not look like ass
	return (
		<div class="flex flex-col space-y-1.5">
			<Label>{props.label}:</Label>
			{/* Avoid nested p tags */}
			{typeof props.data === "string" ? (
				<p class="py-1 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
					{props.data}
				</p>
			) : (
				<div class="py-1 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
					{props.data}
				</div>
			)}
		</div>
	);
}
