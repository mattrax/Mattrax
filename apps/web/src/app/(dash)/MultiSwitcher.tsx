import {
	Command,
	CommandList,
	CommandItem,
	CommandItemLabel,
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@mattrax/ui";
import { Combobox } from "@kobalte/core";
import { For, type ParentProps, createMemo, createSignal } from "solid-js";

import { OrgContext } from "./o.[orgSlug]/Context";
import { TenantContext } from "./o.[orgSlug]/t.[tenantSlug]/Context";
import { useAuth } from "~/components/AuthContext";
import { useOrgSlug } from "./o.[orgSlug]";
import { A, useNavigate } from "@solidjs/router";

export function MultiSwitcher(props: ParentProps) {
	const auth = useAuth();
	const navigate = useNavigate();

	const orgs = createMemo(() =>
		auth().orgs.map((o) => ({ ...o, disabled: false })),
	);
	const orgValue = createMemo(() =>
		orgs().find((o) => o.slug === useOrgSlug()()),
	);

	const [open, setOpen] = createSignal(false);

	return (
		<OrgContext>
			<TenantContext>
				<Popover open={open()} setOpen={setOpen}>
					<PopoverTrigger asChild>{props.children}</PopoverTrigger>
					<PopoverContent class="flex flex-row divide-x divide-gray-300">
						<div class="p-2 w-[12rem]">
							<div class="text-xs text-gray-600 px-2 py-3">Organisations</div>
							<ul>
								<For each={orgs()}>
									{(org) => <a href={`/o/${org.slug}`}>{org.name}</a>}
								</For>
							</ul>
						</div>
						<div class="p-2 w-[12rem]">
							<div class="text-xs text-gray-600 px-2 py-3">Tenants</div>
							<ul>
								<For each={auth().tenants}>
									{(tenant) => {
										const orgSlug = useOrgSlug();
										return (
											<a href={`/o/${orgSlug()}/t/${tenant.slug}`}>
												{tenant.name}
											</a>
										);
									}}
								</For>
							</ul>
						</div>
					</PopoverContent>
				</Popover>
			</TenantContext>
		</OrgContext>
	);
}
