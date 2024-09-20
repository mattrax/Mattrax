import {
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
	Separator,
	buttonVariants,
} from "@mattrax/ui";
import { BreadcrumbItem, BreadcrumbLink } from "@mattrax/ui/breadcrumb";
import { A, useCurrentMatches } from "@solidjs/router";
import clsx from "clsx";
import { For, type ParentProps, Switch } from "solid-js";
import { Page } from "~/components/Page";
import { useBlueprint } from "~/lib/data";

const SEPARATOR = Symbol("SEPARATOR");
const sidebar = [
	{
		name: "General",
		href: "",
	},
	{
		name: "Applications",
		href: "apps",
	},
	{
		name: "Security",
		href: "security",
	},
	{
		name: "Wi-Fi",
		href: "wifi",
	},
	{
		name: "Restrictions",
		href: "restrictions",
	},
	{
		name: "Custom",
		href: "custom",
	},
	SEPARATOR,
	{
		name: "Devices",
		href: "devices",
	},
] as const;

export default function (props: ParentProps) {
	const blueprint = useBlueprint();
	const matches = useCurrentMatches();

	const title = () =>
		matches()[matches().length - 1]?.route.info?.title || null;
	const description = () =>
		matches()[matches().length - 1]?.route.info?.description || null;

	// TODO: Suspense
	return (
		<Page
			title={"Blueprint 0"}
			breadcrumbs={[
				<BreadcrumbItem>
					<BreadcrumbLink href="../../blueprints">Blueprints</BreadcrumbLink>
				</BreadcrumbItem>,
				<BreadcrumbItem class="font-bold text-black/60">
					{blueprint.data?.name}
				</BreadcrumbItem>,
			]}
			right={
				<DropdownMenu placement="top-end">
					<DropdownMenuTrigger as={Button} variant="ghost" class="border">
						Actions
						<IconPhCaretDown class="ml-1" />
					</DropdownMenuTrigger>
					<DropdownMenuContent>
						<DropdownMenuItem onClick={() => alert("todo")}>
							<IconPhArrowCounterClockwise class="mr-1" />
							Sync
						</DropdownMenuItem>
						<DropdownMenuItem onClick={() => alert("todo")}>
							<IconPhCopy class="mr-1" />
							Duplicate
						</DropdownMenuItem>
						<DropdownMenuItem onClick={() => alert("todo")}>
							<IconPhTrash class="mr-1" />
							Delete
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			}
		>
			<div class="flex flex-col space-y-8 lg:flex-row lg:space-x-6 lg:space-y-0 h-screen">
				<aside class="flex space-x-2 lg:flex-col lg:space-x-0 lg:space-y-1 w-full max-w-52 pr-4 border-r-2 h-full">
					<div class="flex justify-between">
						<h1 class="text-3xl font-bold tracking-tight !mt-2 mb-4 md:mb-5">
							Blueprint 0
						</h1>

						{/* <div>{props.right ?? null}</div> */}
					</div>

					<For each={sidebar}>
						{(item) => {
							if (item === SEPARATOR)
								return (
									<div class=" py-1">
										<Separator />
									</div>
								);

							return (
								<A
									end
									href={item.href}
									class={clsx(
										buttonVariants({ variant: "ghost" }),
										"!justify-start",
									)}
									activeClass="bg-muted hover:bg-muted"
									inactiveClass="hover:bg-transparent hover:underline"
								>
									{item.name}
								</A>
							);
						}}
					</For>

					{/* <Button onClick={() => alert("todo")} class="mb-2 mt-8">
						Save
					</Button> */}
				</aside>
				<div class="flex-1 space-y-6">
					{/* <div>
						<h3 class="text-lg font-medium">{title()}</h3>
						<p class="text-sm text-muted-foreground">{description()}</p>
					</div>
					<Separator /> */}

					{props.children}
				</div>
			</div>
		</Page>
	);
}
