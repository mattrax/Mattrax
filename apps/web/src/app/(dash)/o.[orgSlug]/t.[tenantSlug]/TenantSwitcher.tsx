import { As, Combobox, DropdownMenu as KDropdownMenu } from "@kobalte/core";
import { Suspense } from "solid-js";

import {
	Button,
	Command,
	CommandInput,
	CommandItem,
	CommandItemLabel,
	CommandList,
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

	return (
		<CreateTenantDialog {...props}>
			<DropdownMenu controller={controller} sameWidth placement="bottom">
				<DropdownMenuTrigger asChild>
					<As component={Button} variant="ghost" size="iconSmall">
						<KDropdownMenu.Icon>
							<IconPhCaretUpDown class="h-5 w-5 -mx-1" />
						</KDropdownMenu.Icon>
					</As>
				</DropdownMenuTrigger>

				<DropdownMenuContent>
					<Suspense>
						<Command
							optionLabel="label"
							optionGroupChildren="options"
							options={[
								{
									options: auth().tenants,
								},
								{
									options: ["create-tenant"],
								},
							]}
							itemComponent={(iprops) => {
								if (iprops.item.rawValue === "create-tenant")
									return (
										<>
											<DropdownMenuSeparator />
											<DialogTrigger asChild>
												<As component={CommandItem} item={iprops.item}>
													Create new tenant
												</As>
											</DialogTrigger>
										</>
									);

								return (
									<CommandItem
										item={iprops.item}
										onClick={() =>
											props.setActiveTenant(iprops.item.rawValue.slug)
										}
									>
										<CommandItemLabel>
											{iprops.item.rawValue.name}
										</CommandItemLabel>
									</CommandItem>
								);
							}}
							sectionComponent={(props) => (
								<Combobox.Section>
									{props.section.rawValue.label}
								</Combobox.Section>
							)}
						>
							<CommandInput />
							<CommandList />
						</Command>
					</Suspense>
				</DropdownMenuContent>
			</DropdownMenu>
		</CreateTenantDialog>
	);
}
