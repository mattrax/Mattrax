import type { RouterOutput } from "@mattrax/api/client";
import { Badge, BreadcrumbItem, Button, buttonVariants } from "@mattrax/ui";
import { createTimeAgo } from "@solid-primitives/date";
import { A } from "@solidjs/router";
import { Suspense } from "solid-js";
import { stringSimilarity } from "string-similarity-js";
import { match } from "ts-pattern";
import { useTenantId } from "~/app/(dash)";
import { Page } from "~/components/Page";
import { Table, defineTable, toOptions } from "~/components/Table";
import { trpc } from "~/lib";

const def = defineTable<RouterOutput["device"]["list"][number]>({
	columns: {
		name: {
			title: "Name",
			size: 2,
			sort: (a, b) => a.name.localeCompare(b.name),
			render: (row) => (
				<A href={`./${row.id}`} class="text-black">
					{row.name}
				</A>
			),
		},
		enrollmentType: {
			title: "Enrollment Type",
			sort: (a, b) => a.enrollmentType.localeCompare(b.enrollmentType),
			render: (row) => <Badge>{row.enrollmentType.toUpperCase()}</Badge>,
		},
		os: {
			title: "Operating System",
			sort: (a, b) => a.os.localeCompare(b.os),
			render: (row) => (
				<span class="h-full">
					{match(row.os)
						.with("Windows", () => <IconLogosMicrosoftWindowsIcon />)
						.with("iOS", () => <IconLogosIos />)
						.with("macOS", () => <IconLogosMacos class="h-4" />)
						.with("tvOS", () => "tvOS")
						.with("Android", () => <IconLogosAndroidIcon />)
						.with("ChromeOS", () => <IconLogosChrome />)
						.exhaustive()}
				</span>
			),
		},
		serial: {
			title: "Serial Number",
			sort: (a, b) => a.serial.localeCompare(b.serial),
			render: (row) => row.serial,
		},
		blueprint: {
			title: "Blueprint",
			sort: (a, b) => a.blueprint.name.localeCompare(b.blueprint.name),
			render: (row) => {
				return (
					<A href={`../blueprints/${row.blueprint.id}`} class="text-black">
						{row.blueprint.name}
					</A>
				);
			},
		},
		enrolledAt: {
			title: "Enrolled At",
			sort: (a, b) =>
				// @ts-expect-error: Trust me dates can sort
				b.enrolledAt - a.enrolledAt,
			render: (row) => {
				const [date] = createTimeAgo(row.enrolledAt);
				return <p class="text-gray-500">{date()}</p>;
			},
		},
	},
	filters: {
		os: {
			title: "Operating System",
			icon: IconPhComputerTower,
			options: toOptions([
				"Windows",
				"iOS",
				"macOS",
				"tvOS",
				"Android",
				"ChromeOS",
			]),
			apply: (row, selected) => selected.includes(row.os),
		},
		enrollmentType: {
			title: "Enrollment Type",
			icon: IconPhLink,
			options: {
				user: "User",
				device: "Device",
			},
			apply: (row, selected) => selected.includes(row.enrollmentType),
		},
		blueprint: {
			title: "Blueprint",
			icon: IconPhScroll,
			options: toOptions(["Blueprint 1", "Blueprint 2"]), // TODO: Get from API
			apply: (row, selected) => false, // TODO
		},
	},
	bulkActions: {
		assign: () => (
			<Button size="sm" onClick={() => alert("TODO")}>
				Assign blueprint
			</Button>
		),
		// TODO: Device actions
	},
	search: (t, query) => {
		let score = stringSimilarity(t.name, query);
		if (t.serial) score = Math.max(score, stringSimilarity(t.serial, query));
		return score;
	},
});

export default function () {
	const tenantId = useTenantId();
	const devices = trpc.device.list.createQuery(() => ({
		tenantId: tenantId(),
	}));

	return (
		<Page
			breadcrumbs={[<BreadcrumbItem bold>Devices</BreadcrumbItem>]}
			class="p-4"
		>
			<Suspense fallback={<p>TODO: Loading...</p>}>
				<Table
					def={def}
					data={devices.data?.flat()}
					left={
						<A
							href="./enroll"
							class={buttonVariants({ size: "sm", variant: "outline" })}
						>
							<IconPhLink class="pr-1 h-5 w-5" />
							Enroll
						</A>
					}
				/>
			</Suspense>
		</Page>
	);
}
