import { Badge, BreadcrumbItem, Button } from "@mattrax/ui";
import { createTimeAgo } from "@solid-primitives/date";
import { A } from "@solidjs/router";
import { Suspense } from "solid-js";
import { stringSimilarity } from "string-similarity-js";
import { match } from "ts-pattern";
import type { RouterOutput } from "~/api";
import { useTenantId } from "~/app/(dash)";
import { Page } from "~/components/Page";
import { Table, defineTable, toOptions } from "~/components/Table";
import { trpc } from "~/lib";

const def = defineTable<RouterOutput["device"]["list"][number]>({
	columns: {
		name: {
			title: "Name",
			size: 2,
			render: (row) => (
				<A href={`./${row.id}`} class="text-black">
					{row.name}
				</A>
			),
		},
		enrollmentType: {
			title: "Enrollment Type",
			render: (row) => <Badge>{row.enrollmentType.toUpperCase()}</Badge>,
		},
		os: {
			title: "Operating System",
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
			render: (row) => row.serialNumber,
		},
		blueprint: {
			title: "Blueprint",
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
		delete: () => (
			<Button variant="destructive" size="sm" onClick={() => alert("TODO")}>
				Delete
			</Button>
		),
		assign: () => (
			<Button size="sm" onClick={() => alert("TODO")}>
				Assign blueprint
			</Button>
		),
	},
	search: (t, query) => {
		let score = stringSimilarity(t.name, query);
		if (t.serialNumber)
			score = Math.max(score, stringSimilarity(t.serialNumber, query));
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
			title="Devices"
			breadcrumbs={[
				<BreadcrumbItem>
					<BreadcrumbItem>Devices</BreadcrumbItem>
				</BreadcrumbItem>,
			]}
		>
			<Suspense fallback={<p>TODO: Loading...</p>}>
				<Table def={def} data={devices.data?.flat()} />
			</Suspense>
		</Page>
	);
}
