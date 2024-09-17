import { BreadcrumbItem, BreadcrumbLink } from "@mattrax/ui/breadcrumb";
import { z } from "zod";
import { Page, Page2 } from "~/components/Page";
import { useZodParams } from "~/lib/useZodParams";

export default function () {
	const params = useZodParams({ deviceId: z.string() });

	// TODO: Hook up the API
	const deviceName = params.deviceId;
	const deviceType = "XPS 13 9310 2-in-1";

	return (
		<Page2
			title="Devices"
			breadcrumbs={[
				<BreadcrumbItem>
					<BreadcrumbLink href="../../devices">Devices</BreadcrumbLink>
				</BreadcrumbItem>,
				<BreadcrumbItem class="font-bold text-black/60">
					{deviceName}
				</BreadcrumbItem>,
			]}
		>
			<div class="flex items-center space-x-4 p-4 w-full">
				{/* // TODO: Detect the device type */}
				<img
					alt="TODO"
					class="w-20 h-20"
					src="https://configure.mattrax.app/assets/com.apple.macbookair-11-unibody-CDtx43Hm.png"
				/>
				<div>
					<h1 class="text-3xl font-bold">{deviceName}</h1>
					<h2 class="flex items-center mt-1 opacity-80 text-sm">
						{/* // TODO: Detect the OS */}
						<IconLogosMicrosoftWindowsIcon class="mr-2" />
						{deviceType}
					</h2>
				</div>
				<div class="flex-1"></div>
				<div class="flex space-x-4">
					{/* <a
						target="_blank"
						rel="noreferrer"
						class="ring-offset-background focus-visible:ring-ring inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 text-primary underline-offset-4 hover:underline h-10 px-4 py-2 !p-0"
						href="https://intune.microsoft.com/3509b545-2799-4c5c-a0d2-f822ddbd416c#view/Microsoft_Intune_Devices/DeviceSettingsMenuBlade/~/overview/mdmDeviceId/5ce6d98a-976c-46ca-a2ea-8dea484dd396"
					>
						Microsoft Entra ID
						<svg
							viewBox="0 0 24 24"
							width="1.2em"
							height="1.2em"
							class="inline ml-1"
						>
							<path
								fill="currentColor"
								d="M18 20.75H6A2.75 2.75 0 0 1 3.25 18V6A2.75 2.75 0 0 1 6 3.25h6a.75.75 0 0 1 0 1.5H6A1.25 1.25 0 0 0 4.75 6v12A1.25 1.25 0 0 0 6 19.25h12A1.25 1.25 0 0 0 19.25 18v-6a.75.75 0 0 1 1.5 0v6A2.75 2.75 0 0 1 18 20.75m2-12a.76.76 0 0 1-.75-.75V4.75H16a.75.75 0 0 1 0-1.5h4a.76.76 0 0 1 .75.75v4a.76.76 0 0 1-.75.75"
							></path>
							<path
								fill="currentColor"
								d="M13.5 11.25A.74.74 0 0 1 13 11a.75.75 0 0 1 0-1l6.5-6.5a.75.75 0 1 1 1.06 1.06L14 11a.74.74 0 0 1-.5.25"
							></path>
						</svg>
					</a> */}
					<button
						type="button"
						class="ring-offset-background focus-visible:ring-ring inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
						id="dropdownmenu-cl-338-trigger"
						aria-haspopup="true"
						aria-expanded="false"
						data-pointer-type="mouse"
						data-closed=""
						onClick={() => alert("TODO")}
					>
						Actions
						<svg
							viewBox="0 0 256 256"
							width="1.2em"
							height="1.2em"
							class="ml-1 w-3 h-3"
						>
							<title>TODO</title>
							<path
								fill="currentColor"
								d="m213.66 101.66l-80 80a8 8 0 0 1-11.32 0l-80-80a8 8 0 0 1 11.32-11.32L128 164.69l74.34-74.35a8 8 0 0 1 11.32 11.32"
							/>
						</svg>
					</button>
				</div>
			</div>

			{/* // TODO: Device information */}
			{/* // TODO: Manage assignments */}
			{/* // TODO: Device actions */}

			<div class="gap-4 flex flex-col">
				{/* // TODO: Remove the bg-... from this */}
				<div class="text-card-foreground rounded-lg border shadow-sm">
					<div class="p-8 grid grid-cols-4 gap-y-8 gap-x-4">
						<div>
							<p class="text-sm text-stone-500 font-medium tracking-tight">
								Identifier
							</p>
							<p class="text-sm font-medium">
								850ab676-7fe9-4e7f-9219-8df2ab873a62
							</p>
						</div>
						<div>
							<p class="text-sm text-stone-500 font-medium tracking-tight">
								Name
							</p>
							<p class="text-sm font-medium">OSCARS-XPS-13</p>
						</div>
						<div>
							<p class="text-sm text-stone-500 font-medium tracking-tight">
								Ownership
							</p>
							<p class="text-sm font-medium">company</p>
						</div>
						<div>
							<p class="text-sm text-stone-500 font-medium tracking-tight">
								Last Sign in Date
							</p>
							{/* <p class="text-sm font-medium"></p> */}
						</div>
						<div>
							<p class="text-sm text-stone-500 font-medium tracking-tight">
								Model
							</p>
							<p class="text-sm font-medium">XPS 13 9310 2-in-1</p>
						</div>
						<div>
							<p class="text-sm text-stone-500 font-medium tracking-tight">
								Manufacturer
							</p>
							<p class="text-sm font-medium">Dell Inc.</p>
						</div>
						<div>
							<p class="text-sm text-stone-500 font-medium tracking-tight">
								Model
							</p>
							<p class="text-sm font-medium">XPS 13 9310 2-in-1</p>
						</div>
						<div>
							<p class="text-sm text-stone-500 font-medium tracking-tight">
								Operating System
							</p>
							<p class="text-sm font-medium">Windows</p>
						</div>
						<div>
							<p class="text-sm text-stone-500 font-medium tracking-tight">
								Operating System Version
							</p>
							<p class="text-sm font-medium">10.0.22631.3672</p>
						</div>
						<div>
							<p class="text-sm text-stone-500 font-medium tracking-tight">
								Registration Time
							</p>
							{/* <p class="text-sm font-medium"></p> */}
						</div>
						<div>
							<p class="text-sm text-stone-500 font-medium tracking-tight">
								Trust Type
							</p>
							<p class="text-sm font-medium">unknown</p>
						</div>
						<div>
							<p class="text-sm text-stone-500 font-medium tracking-tight">
								Type
							</p>
							{/* <p class="text-sm font-medium"></p> */}
						</div>
						<div>
							<p class="text-sm text-stone-500 font-medium tracking-tight">
								Compliant
							</p>
							{/* <p class="text-sm font-medium"> */}
							<div class="focus:ring-ring inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 bg-primary text-primary-foreground hover:bg-primary/80 border-transparent">
								Compliant
							</div>
							{/* </p> */}
						</div>
						<div>
							<p class="text-sm text-stone-500 font-medium tracking-tight">
								Managed
							</p>
							{/* <p class="text-sm font-medium"> */}
							<div class="focus:ring-ring inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 bg-primary text-primary-foreground hover:bg-primary/80 border-transparent">
								Managed
							</div>
							{/* </p> */}
						</div>
						<div>
							<p class="text-sm text-stone-500 font-medium tracking-tight">
								Rooted
							</p>
							{/* <p class="text-sm font-medium"> */}
							<div class="focus:ring-ring inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 bg-destructive text-destructive-foreground hover:bg-destructive/80 border-transparent">
								Not rooted
							</div>
							{/* </p> */}
						</div>
						<div>
							<p class="text-sm text-stone-500 font-medium tracking-tight">
								Device Category
							</p>
							{/* <p class="text-sm font-medium"></p> */}
						</div>
					</div>
				</div>
			</div>
		</Page2>
	);
}
