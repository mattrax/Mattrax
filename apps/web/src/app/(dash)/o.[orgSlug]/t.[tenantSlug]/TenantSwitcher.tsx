import { As, DropdownMenu as KDropdownMenu } from "@kobalte/core";
import { For, Suspense } from "solid-js";

import {
	Button,
	DialogTrigger,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
	createController,
} from "@mattrax/ui";
import { CreateTenantDialog } from "./CreateTenantDialog";
import { useAuth } from "~c/AuthContext";
import { useTenant } from "./Context";

export type TenantSwitcherProps = {
	setActiveTenant: (id: string) => void;
};

export function TenantSwitcher(props: TenantSwitcherProps) {
	const controller = createController();

	const auth = useAuth();
	const tenant = useTenant();

	return (
		<div class="relative inline-block text-left">
			<CreateTenantDialog {...props}>
				<DropdownMenu controller={controller} sameWidth placement="bottom">
					<div class="flex flex-row items-center gap-2">
						<span>{tenant().name}</span>
						<DropdownMenuTrigger asChild>
							<As component={Button} variant="ghost" size="iconSmall">
								<KDropdownMenu.Icon>
									<IconPhCaretUpDown class="h-5 w-5 -mx-1" />
								</KDropdownMenu.Icon>
							</As>
						</DropdownMenuTrigger>
					</div>
					<DropdownMenuContent>
						<Suspense>
							<For each={auth().tenants}>
								{(tenant) => (
									<DropdownMenuItem
										class={
											"block px-4 py-2 text-sm text-left w-full truncate hover:bg-gray-200"
										}
										onSelect={() => props.setActiveTenant(tenant.slug)}
									>
										{/* TODO: Use a link here instead of JS for accessibility */}
										{tenant.name}
									</DropdownMenuItem>
								)}
							</For>

							{auth().tenants.length !== 0 && <DropdownMenuSeparator />}
						</Suspense>

						<DialogTrigger asChild>
							<As
								component={DropdownMenuItem}
								as="button"
								class={
									"block px-4 py-2 text-sm text-left w-full hover:bg-gray-200 rounded-b-md"
								}
							>
								Create new tenant
							</As>
						</DialogTrigger>
					</DropdownMenuContent>
				</DropdownMenu>
			</CreateTenantDialog>
		</div>
	);
}
