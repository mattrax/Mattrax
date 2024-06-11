import { createTimeAgo } from "@solid-primitives/date";
import {
	A,
	type RouteDefinition,
	useLocation,
	useNavigate,
} from "@solidjs/router";
import { createColumnHelper } from "@tanstack/solid-table";
import { Show, Suspense, createSignal, onMount } from "solid-js";
import type { RouterOutput } from "~/api/trpc";

import {
	Button,
	ComboboxContentVirtualized,
	ComboboxControl,
	ComboboxInput,
	ComboboxRoot,
	ComboboxTrigger,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
	DropdownMenuTrigger,
	Input,
	Label,
	Select,
	SelectContent,
	SelectContentVirtualized,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
	buttonVariants,
} from "@mattrax/ui";
import clsx from "clsx";
import { Dynamic } from "solid-js/web";
import { toast } from "solid-sonner";
import { match } from "ts-pattern";
import { TableSearchParamsInput } from "~/components/TableSearchParamsInput";
import { env } from "~/env";
import { trpc } from "~/lib";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import {
	ColumnsDropdown,
	FloatingSelectionBar,
	StandardTable,
	createSearchParamFilter,
	createStandardTable,
	selectCheckboxColumn,
} from "~c/StandardTable";
import IconCarbonCaretDown from "~icons/carbon/caret-down.jsx";
import { useTenantSlug } from "../ctx";
import { cacheMetadata } from "../metadataCache";
import { BruhIconPhArrowSquareOut, BruhIconPhCopyDuotone } from "./bruh";

export const route = {
	load: ({ params }) => {
		trpc.useContext().device.list.ensureData({
			tenantSlug: params.tenantSlug!,
		});
	},
} satisfies RouteDefinition;

const column = createColumnHelper<RouterOutput["device"]["list"][number]>();

const columns = [
	selectCheckboxColumn,
	column.accessor("name", {
		header: "Name",
		cell: (props) => (
			<A
				class="font-medium hover:underline focus:underline p-1 -m-1 w-full block"
				href={props.row.original.id}
			>
				{props.getValue()}
			</A>
		),
	}),
	column.accessor("os", { header: "Operating System" }),
	column.accessor("serialNumber", { header: "Serial Number" }),
	column.accessor("owner", {
		header: "Owner",
		cell: (props) => (
			<A
				class="font-medium hover:underline focus:underline p-1 -m-1 w-full block"
				href={`../users/${props.getValue()!.id}`}
			>
				{props.getValue()!.name}
			</A>
		),
	}),
	column.accessor("lastSynced", {
		header: "Last Synced",
		cell: (cell) => {
			const [timeago] = createTimeAgo(cell.getValue());
			return <p>{timeago()}</p>;
		},
	}),
	column.accessor("enrolledAt", {
		header: "Enrolled At",
		cell: (cell) => {
			const [timeago] = createTimeAgo(cell.getValue());
			return <p>{timeago()}</p>;
		},
	}),
];

// TODO: Infinite scroll

// TODO: Disable search, filters and sort until all backend metadata has loaded in. Show tooltip so it's clear what's going on.

export default function Page() {
	const location = useLocation<{ enrollDialog?: boolean }>();
	const tenantSlug = useTenantSlug();
	const navigate = useNavigate();

	const devices = trpc.device.list.createQuery(() => ({
		tenantSlug: tenantSlug(),
	}));
	cacheMetadata("device", () => devices.data ?? []);

	const table = createStandardTable({
		get data() {
			return devices.data || [];
		},
		columns,
	});

	// createSearchParamPagination(table, "page");
	createSearchParamFilter(table, "name", "search");

	// This will unset `enrollDialog` from the state so it doesn't show again
	onMount(() =>
		navigate(".", {
			replace: true,
		}),
	);

	return (
		<PageLayout
			heading={
				<>
					<PageLayoutHeading>Devices</PageLayoutHeading>
					<Dialog defaultOpen={location.state?.enrollDialog}>
						<DialogTrigger as={Button} class="ml-auto">
							Enroll
						</DialogTrigger>
						<DialogContent>
							<EnrollDeviceModal />
						</DialogContent>
					</Dialog>
				</>
			}
		>
			<div class="flex flex-row items-center gap-4">
				<TableSearchParamsInput class="flex-1" query={devices} />
				<ColumnsDropdown table={table}>
					<DropdownMenuTrigger
						as={Button}
						variant="outline"
						class="ml-auto select-none"
					>
						Columns
						<IconCarbonCaretDown class="ml-2 h-4 w-4" />
					</DropdownMenuTrigger>
				</ColumnsDropdown>
			</div>
			<Suspense>
				<StandardTable table={table} />
				<FloatingSelectionBar table={table} />
			</Suspense>
		</PageLayout>
	);
}

const platforms = ["Windows", "Apple", "Android"] as const;

function EnrollDeviceModal() {
	const tenantSlug = useTenantSlug();
	const provider = trpc.tenant.identityProvider.get.createQuery(() => ({
		tenantSlug: tenantSlug(),
	}));
	const users = trpc.user.list.createQuery(
		() => ({
			tenantSlug: tenantSlug(),
		}),
		() => ({
			placeholderData: [],
		}),
	);
	const generateEnrollmentSession =
		trpc.device.generateEnrollmentSession.createMutation();

	const [user, setUser] = createSignal<string | null>(null);
	const [platform, setPlatform] = createSignal<(typeof platforms)[number]>(
		platforms[0],
	);
	const isRunningOnWindows = navigator.userAgent.includes("Win");

	// TODO: This would be nicer as `Combobox.useContext` but it no exist.
	const [count, setCount] = createSignal<number | null>(null);

	return (
		<DialogHeader>
			<DialogTitle>Enroll a device</DialogTitle>
			<h2 class="text-foreground text-md font-semibold">
				User-initiated enrollment
			</h2>
			<DialogDescription>
				Your users can go to{" "}
				<A
					href="/enroll"
					target="_blank"
					class="underline"
				>{`${env.VITE_PROD_ORIGIN}/enroll`}</A>{" "}
				and login with{" "}
				<Suspense fallback="their email">
					{match(provider.data?.provider || "entraId")
						.with("entraId", () => "EntraID")
						.exhaustive()}
				</Suspense>{" "}
				to enroll their own devices.
			</DialogDescription>

			<h2 class="text-foreground text-md font-semibold">
				Administrator-initiated enrollment
			</h2>

			<DialogDescription>
				Enroll the current device on behalf of another user.
			</DialogDescription>

			<ComboboxRoot
				virtualized
				value={user()}
				onChange={setUser}
				disallowEmptySelection={false}
				options={users.data?.map((user) => user.id) || []}
				disabled={
					generateEnrollmentSession.isPending ||
					!users.data ||
					users.data.length === 0
				}
				defaultFilter={(option, inputValue) => {
					const item = users.data!.find((u) => u.id === option)!;

					console.log(
						option,
						inputValue,
						item.name,
						item.name.toLowerCase().includes(inputValue.toLowerCase()) || false,
						users.data?.filter((u) =>
							u.name.toLowerCase().includes(inputValue.toLowerCase()),
						)?.length || 0,
					);

					setCount(
						users.data?.filter((u) =>
							u.name.toLowerCase().includes(inputValue.toLowerCase()),
						)?.length || 0,
					);

					return (
						item.name.toLowerCase().includes(inputValue.toLowerCase()) || false
					);
				}}
				placeholder="System"
				class="flex-1 pb-2"
			>
				<ComboboxControl aria-label="User to enroll as">
					<ComboboxInput
						value={users.data?.find((u) => u.id === user())?.name || ""}
						onFocusOut={(e) => {
							setCount(null);
							e.currentTarget.value =
								users.data?.find((u) => u.id === user())?.name || "";
						}}
					/>
					<ComboboxTrigger />
				</ComboboxControl>

				<ComboboxContentVirtualized
					length={() => count() || users.data?.length || 0}
					getItemIndex={(id) => users.data!.findIndex((user) => user.id === id)}
				>
					{(_, i) => (
						<>
							{users.data![i]!.name}
							{users.data![i]!.id}
						</>
					)}
				</ComboboxContentVirtualized>
			</ComboboxRoot>
			<div class="flex w-full">
				<Select
					value={platform()}
					onChange={setPlatform}
					// @ts-expect-error
					options={platforms}
					placeholder="Select a platform..."
					disabled={generateEnrollmentSession.isPending}
					itemComponent={(props) => (
						<SelectItem
							item={props.item}
							disabled={props.item.rawValue !== "Windows"}
						>
							{props.item.rawValue}
						</SelectItem>
					)}
					class="flex-1"
				>
					<SelectTrigger aria-label="Platform" class="w-full">
						<SelectValue<string>>
							{(state) => state.selectedOption()}
						</SelectValue>
					</SelectTrigger>
					<SelectContent />
				</Select>
				<Button
					class="w-full max-w-40 ml-4"
					disabled={generateEnrollmentSession.isPending}
					onClick={() => {
						if (platform() !== "Windows") throw new Error("Not implemented");

						generateEnrollmentSession.mutate({
							tenantSlug: tenantSlug(),
							userId: user(),
						});
					}}
				>
					Enroll
				</Button>
			</div>

			<Show when={generateEnrollmentSession.data}>
				{(url) => (
					<>
						<div class="flex flex-col space-y-1.5 pt-2">
							<Label>
								To start enrollment open the following link on a Windows device:
							</Label>
							<div class="flex space-x-2">
								<Input readOnly value={url()} />
								<Button
									onClick={() => {
										navigator.clipboard.writeText(url());
										toast.success("Copied to clipboard", {
											id: "clipboard",
										});
									}}
								>
									<BruhIconPhCopyDuotone />
								</Button>
								<Tooltip openDelay={0}>
									<TooltipTrigger>
										<Dynamic
											component={isRunningOnWindows ? "a" : "span"}
											href={url()}
											class={clsx(
												buttonVariants({}),
												!isRunningOnWindows && "cursor-not-allowed opacity-75",
											)}
										>
											<BruhIconPhArrowSquareOut />
										</Dynamic>
									</TooltipTrigger>
									{!isRunningOnWindows && (
										<TooltipContent>
											You must be on a Windows device.
										</TooltipContent>
									)}
								</Tooltip>
							</div>
							<p class="text-muted-foreground text-sm">
								This link is valid for 7 days
							</p>
						</div>
					</>
				)}
			</Show>
		</DialogHeader>
	);
}
