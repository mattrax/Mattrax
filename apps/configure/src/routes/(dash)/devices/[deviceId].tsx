import {
	Badge,
	Button,
	Card,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	buttonVariants,
} from "@mattrax/ui";
import clsx from "clsx";
import { Show, Suspense } from "solid-js";
import { z } from "zod";
import { determineDeviceImage } from "~/assets";
import { PageLayout } from "~/components/PageLayout";
import { getKey } from "~/lib/kv";
import { createDbQuery } from "~/lib/query";
import { useZodParams } from "~/lib/useZodParams";
import { Field, renderDate } from "../users/[userId]";

export default function Page() {
	const params = useZodParams({
		deviceId: z.string(),
	});

	const data = createDbQuery((db) => db.get("devices", params.deviceId));
	// TODO: 404 handling

	const org = createDbQuery((db) => getKey(db, "org"));

	const entraIdLink = () => {
		const orgId = org()?.id;
		const deviceId = data()?.deviceId;
		if (!orgId || !deviceId) return;
		return `https://intune.microsoft.com/${encodeURIComponent(orgId)}#view/Microsoft_Intune_Devices/DeviceSettingsMenuBlade/~/overview/mdmDeviceId/${encodeURIComponent(deviceId)}`;
	};

	return (
		<PageLayout
			class="max-w-7xl space-y-2"
			heading={
				<div class="flex items-center space-x-4 p-4 w-full">
					<img src={determineDeviceImage()} alt="TODO" class="w-20 h-20" />

					<div>
						<h1 class="text-3xl font-bold">
							<Suspense
								fallback={
									<div class="w-42 h-8 rounded-full bg-neutral-200 animate-pulse" />
								}
							>
								{data()?.name}
							</Suspense>
						</h1>
						<h2 class="flex items-center mt-1 opacity-80 text-sm">
							{/* // TODO: Make this actually determined from the data */}
							<IconLogosMicrosoftWindowsIcon class="mr-2" />

							<Suspense
								fallback={
									<div class="w-52 h-4 rounded-full bg-neutral-200 animate-pulse" />
								}
							>
								{data()?.model}
							</Suspense>
						</h2>
					</div>

					<div class="flex-1" />

					<div class="flex space-x-4">
						<a
							class={clsx(
								buttonVariants({ variant: "link" }),
								"!p-0",
								!entraIdLink() ? "cursor-default select-none" : "",
							)}
							target="_blank"
							href={entraIdLink()}
							rel="noreferrer"
						>
							Microsoft Entra ID
							<IconPrimeExternalLink class="inline ml-1" />
						</a>

						<DropdownMenu>
							<DropdownMenuTrigger as={Button}>
								Actions
								<IconPhCaretDown class="ml-1 w-3 h-3" />
							</DropdownMenuTrigger>
							<DropdownMenuContent>
								<DropdownMenuItem onClick={() => alert("TODO")}>
									Sync
								</DropdownMenuItem>
								<DropdownMenuItem onClick={() => alert("TODO")}>
									Reboot
								</DropdownMenuItem>
								<DropdownMenuItem onClick={() => alert("TODO")}>
									New remote assistance session
								</DropdownMenuItem>
								<DropdownMenuItem onClick={() => alert("TODO")}>
									Locate device
								</DropdownMenuItem>
								<DropdownMenuItem onClick={() => alert("TODO")}>
									Run remediation
								</DropdownMenuItem>
								<DropdownMenuItem
									class="text-destructive"
									onClick={() => alert("TODO")}
								>
									Remote Lock
								</DropdownMenuItem>
								<DropdownMenuItem
									class="text-destructive"
									onClick={() => alert("TODO")}
								>
									Reset passcode
								</DropdownMenuItem>
								<DropdownMenuItem
									class="text-destructive"
									onClick={() => alert("TODO")}
								>
									Collect diagnostics
								</DropdownMenuItem>
								<DropdownMenuItem
									class="text-destructive"
									onClick={() => alert("TODO")}
								>
									Fresh Start
								</DropdownMenuItem>
								<DropdownMenuItem
									class="text-destructive"
									onClick={() => alert("TODO")}
								>
									Autopilot Reset
								</DropdownMenuItem>
								<DropdownMenuItem
									class="text-destructive"
									onClick={() => alert("TODO")}
								>
									Quick scan
								</DropdownMenuItem>
								<DropdownMenuItem
									class="text-destructive"
									onClick={() => alert("TODO")}
								>
									Full scan
								</DropdownMenuItem>
								<DropdownMenuItem
									class="text-destructive"
									onClick={() => alert("TODO")}
								>
									Update Windows Defender security intelligence
								</DropdownMenuItem>
								<DropdownMenuItem
									class="text-destructive"
									onClick={() => alert("TODO")}
								>
									Rotate local admin password
								</DropdownMenuItem>
								<DropdownMenuItem
									class="text-destructive"
									onClick={() => alert("TODO")}
								>
									BitLocker key rotation
								</DropdownMenuItem>
								<DropdownMenuItem
									class="text-destructive"
									onClick={() => alert("TODO")}
								>
									Pause config refresh
								</DropdownMenuItem>
								<DropdownMenuItem
									class="text-destructive"
									onClick={() => alert("TODO")}
								>
									Retire
								</DropdownMenuItem>
								<DropdownMenuItem
									class="text-destructive"
									onClick={() => alert("TODO")}
								>
									Wipe
								</DropdownMenuItem>
								<DropdownMenuItem
									class="text-destructive"
									onClick={() => alert("TODO")}
								>
									Delete
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</div>
			}
		>
			<Card>
				<div class="p-8 grid grid-cols-4 gap-y-8 gap-x-4">
					<Field label="Identifier" value={data()?.id} />
					<Field label="Name" value={data()?.name} />
					<Field label="Ownership" value={data()?.deviceOwnership} />

					<Field label="Last Sign in Date" value={data()?.lastSignInDate} />

					<Field label="Model" value={data()?.model} />
					<Field label="Manufacturer" value={data()?.manufacturer} />
					{/* <Field label="Serial Number" value={data()?.serialNumber} /> */}
					<Field label="Model" value={data()?.model} />

					{/* // TODO: Merge these two things */}
					<Field label="Operating System" value={data()?.operatingSystem} />
					<Field
						label="Operating System Version"
						value={data()?.operatingSystemVersion}
					/>

					<Field
						label="Registration Time"
						value={data()?.registrationDateTime}
						render={renderDate}
					/>

					<Field label="Trust Type" value={data()?.trustType} />
					<Field label="Type" value={data()?.type} />

					<Field
						label="Compliant"
						value={data()?.isCompliant}
						render={(v) => (
							<Show when={v === false} fallback={<Badge>Compliant</Badge>}>
								<Badge variant="destructive">Non-compliant</Badge>
							</Show>
						)}
					/>
					<Field
						label="Managed"
						value={data()?.isManaged}
						render={(v) => (
							<Show when={v === false} fallback={<Badge>Managed</Badge>}>
								<Badge variant="destructive">Non-Managed</Badge>
							</Show>
						)}
					/>
					<Field
						label="Rooted"
						value={data()?.isRooted}
						render={(v) => (
							<Show when={v === false} fallback={<Badge>Rooted</Badge>}>
								<Badge variant="destructive">Not rooted</Badge>
							</Show>
						)}
					/>

					<Field label="Device Category" value={data()?.deviceCategory} />

					{/* // TODO: Enrolled by, Management name vs hostname, serial number, last check-in time, primary user, notes */}
				</div>
			</Card>
		</PageLayout>
	);
}
