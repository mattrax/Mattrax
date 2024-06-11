import { createTimeAgo } from "@solid-primitives/date";
import {
	A,
	type RouteDefinition,
	useLocation,
	useNavigate,
} from "@solidjs/router";
import { createColumnHelper } from "@tanstack/solid-table";
import { createVirtualizer } from "@tanstack/solid-virtual";
import {
	type Accessor,
	For,
	Show,
	Suspense,
	createMemo,
	createSignal,
	onCleanup,
	onMount,
} from "solid-js";

import type { RouterOutput } from "~/api/trpc";

import type { Collection, CollectionNode } from "@kobalte/core";
import { Combobox } from "@kobalte/core/combobox";
import {
	Button,
	ComboboxContent,
	// ComboboxContentVirtualized,
	ComboboxControl,
	ComboboxInput,
	ComboboxItem,
	ComboboxListbox,
	ComboboxManaged,
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
				<div class="flex justify-between w-full">
					<PageLayoutHeading>Devices</PageLayoutHeading>
					<Dialog defaultOpen={location.state?.enrollDialog}>
						<DialogTrigger as={Button}>Enroll</DialogTrigger>
						<DialogContent>
							<EnrollDeviceModal />
						</DialogContent>
					</Dialog>
				</div>
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
		() => ({ tenantSlug: tenantSlug() }),
		() => ({ placeholderData: [] }),
	);
	const generateEnrollmentSession =
		trpc.device.generateEnrollmentSession.createMutation();

	const [user, setUser] = createSignal<string | null>(null);
	const [platform, setPlatform] = createSignal<(typeof platforms)[number]>(
		platforms[0],
	);
	const isRunningOnWindows = navigator.userAgent.includes("Win");

	const options = () => users.data ?? [];

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
				multiple={false}
				options={options()}
				defaultFilter="contains"
				virtualized
				optionLabel="name"
				optionValue="id"
				optionTextValue="name"
				optionDisabled={() => false}
				disallowEmptySelection={false}
				placeholder="System"
			>
				<ComboboxControl aria-label="User to enroll as">
					<ComboboxInput />
					<ComboboxTrigger />
				</ComboboxControl>
				<Combobox.Portal>
					<Content options={options()} />
				</Combobox.Portal>
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

function Content(props: {
	options: { id: string; name: string; email: string }[];
}) {
	const [_virtualizerItems, setVirtualizerItems] =
		createSignal<Accessor<Collection<CollectionNode<any>>>>();

	const virtualizerItems = () => _virtualizerItems()?.();

	let scrollRef: HTMLDivElement;
	const virtualizer = createVirtualizer({
		get count() {
			return virtualizerItems()?.getSize() ?? 0;
		},
		getScrollElement: () => scrollRef,
		getItemKey: (index) => virtualizerItems()?.at(index)!.rawValue.id,
		estimateSize: () => 30,
	});

	return (
		<ComboboxContent portal={false}>
			<div
				style={{ height: "200px", width: "100%", overflow: "auto" }}
				class="m-0 p-1"
				ref={scrollRef!}
			>
				<ComboboxListbox<any>
					style={{
						height: `${virtualizer.getTotalSize()}px`,
						width: "100%",
						position: "relative",
					}}
					scrollToItem={(key) =>
						virtualizer.scrollToIndex(
							props.options.findIndex((option) => option.id === key),
						)
					}
				>
					{(items) => {
						setVirtualizerItems(() => items);

						return (
							<For each={virtualizer.getVirtualItems()}>
								{(virtualRow) => {
									const item = createMemo(() =>
										virtualizerItems()?.getItem(virtualRow.key as any),
									);

									return (
										<Show when={item()}>
											{(item) => (
												<ComboboxItem
													item={item()}
													data-index={virtualRow.index}
													ref={(el) =>
														queueMicrotask(() => virtualizer.measureElement(el))
													}
													style={{
														position: "absolute",
														top: 0,
														left: 0,
														width: "100%",
														transform: `translateY(${virtualRow.start}px)`,
													}}
												>
													{item().rawValue.name}
													<span class="text-gray-600 ml-2">
														{item().rawValue.email}
													</span>
												</ComboboxItem>
											)}
										</Show>
									);
								}}
							</For>
						);
					}}
				</ComboboxListbox>
			</div>
		</ComboboxContent>
	);
}
