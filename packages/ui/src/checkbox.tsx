import {
	Checkbox as CheckboxPrimitive,
	type PolymorphicProps,
} from "@kobalte/core";
import type { CheckboxRootProps } from "@kobalte/core/checkbox";
import clsx from "clsx";
import type { ValidComponent } from "solid-js";
import { splitProps } from "solid-js";

const Checkbox = <T extends ValidComponent = "div">(
	props: PolymorphicProps<T, CheckboxRootProps>,
) => {
	const [, rest] = splitProps(props as any, ["class"]);
	return (
		<CheckboxPrimitive.Root
			class={clsx("items-top flex", props.class)}
			{...rest}
		>
			<CheckboxPrimitive.Input class="peer" style={{ position: "relative" }} />
			<CheckboxPrimitive.Control
				class={clsx(
					"border border-primary h-4 w-4 shrink-0 rounded-sm ring-offset-background ",
					"peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-ring transition-all duration-75",
					"ui-checked:bg-primary ui-checked:text-primary-foreground ui-disabled:cursor-not-allowed ui-disabled:opacity-50",
				)}
				onClick={(e) => {
					// debugger;
					e.stopPropagation();
				}}
			>
				<CheckboxPrimitive.Indicator
					as={IconTablerCheck}
					class="h-4 w-4 -m-px"
				/>
			</CheckboxPrimitive.Control>
		</CheckboxPrimitive.Root>
	);
};

export { Checkbox };
