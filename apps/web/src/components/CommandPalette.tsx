import { type ComponentProps, createSignal } from "solid-js";
import { createEventListener } from "@solid-primitives/event-listener";
import {
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	useCommandCtx,
} from "@mattrax/ui";
import { A, useNavigate } from "@solidjs/router";
import { useZodParams } from "~/lib/useZodParams";
import { z } from "zod";

export default function CommandPalette() {
	const [open, setOpen] = createSignal(false);
	const params = useZodParams({
		orgSlug: z.string().optional(),
		tenantSlug: z.string().optional(),
	});

	createEventListener(document, "keydown", (e) => {
		if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			setOpen((open) => !open);
		} else if (e.key === "[" && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			window.history.back();
		} else if (e.key === "]" && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			window.history.forward();
		}
	});

	return (
		<CommandDialog open={open()} onOpenChange={setOpen}>
			<CommandInput
				placeholder="Type a command or search..."
				autocomplete="off"
				spellcheck="false"
			/>
			<CommandList>
				<CommandEmpty>No results found.</CommandEmpty>
				<CommandGroup heading="Navigation">
					{/* // TODO: Config based */}
					<CommandItemA
						href={`/o/${params?.orgSlug}`}
						disabled={!params.orgSlug}
					>
						<span>Organisation Overview</span>
					</CommandItemA>
					{/* // TODO: Define these in the tenant layout cause they are context dependant???? */}
					<CommandItemA
						href={`/o/${params?.orgSlug}/t/${params?.tenantSlug}`}
						disabled={!params.orgSlug || !params.tenantSlug}
					>
						<span>Tenant Overview</span>
					</CommandItemA>
					<CommandItemA
						href={`/o/${params?.orgSlug}/t/${params?.tenantSlug}/users`}
						disabled={!params.orgSlug || !params.tenantSlug}
					>
						<span>Users</span>
					</CommandItemA>
					<CommandItemA
						href={`/o/${params?.orgSlug}/t/${params?.tenantSlug}/devices`}
						disabled={!params.orgSlug || !params.tenantSlug}
					>
						<span>Devices</span>
					</CommandItemA>
					<CommandItemA
						href={`/o/${params?.orgSlug}/t/${params?.tenantSlug}/policies`}
						disabled={!params.orgSlug || !params.tenantSlug}
					>
						<span>Policies</span>
					</CommandItemA>
					<CommandItemA
						href={`/o/${params?.orgSlug}/t/${params?.tenantSlug}/apps`}
						disabled={!params.orgSlug || !params.tenantSlug}
					>
						<span>Applications</span>
					</CommandItemA>
					<CommandItemA
						href={`/o/${params?.orgSlug}/t/${params?.tenantSlug}/groups`}
						disabled={!params.orgSlug || !params.tenantSlug}
					>
						<span>Groups</span>
					</CommandItemA>
					<CommandItemA
						href={`/o/${params?.orgSlug}/t/${params?.tenantSlug}/settings`}
						disabled={!params.orgSlug || !params.tenantSlug}
					>
						<span>Tenant Settings</span>
					</CommandItemA>
					<CommandItemA
						href={`/o/${params?.orgSlug}/settings`}
						disabled={!params.orgSlug}
					>
						<span>Organisation Settings</span>
					</CommandItemA>
					<CommandItemA href="/account">
						<span>Account Settings</span>
					</CommandItemA>
				</CommandGroup>
				{/* <CommandSeparator /> */}
				{/* <CommandGroup heading="Settings"></CommandGroup> */}

				{/* // TODO: Command + click item that is a valid `A` to open in new tab */}

				{/* // TODO: Global search for any resource */}
				{/* // TODO: Switch tenant or org */}
				{/* // TODO: Dark mode/light mode */}

				{/* TODO: Changing pages inside the nested navigation like for devices */}
			</CommandList>
		</CommandDialog>
	);
}

function CommandItemA(
	props: ComponentProps<typeof CommandItem> & {
		href: string;
		disabled?: boolean;
	},
) {
	const navigate = useNavigate();
	const cmd = useCommandCtx();

	return (
		<CommandItem
			aria-disabled={props.disabled}
			disabled={props.disabled}
			onSelect={() => {
				if (!props.disabled) navigate(props.href);
				cmd.setOpen(false);
			}}
			// TODO: Prefetch route data on house hover or focus active
			// onMouseOver={() => console.log("PREFETCH", match()?.path)}
		>
			{props.children}
		</CommandItem>
	);
}
