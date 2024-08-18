import { useBeforeLeave } from "@solidjs/router";
import { type ComponentProps, Show, splitProps } from "solid-js";
import type { FormState } from ".";

export function Form<S>(
	props: Omit<ComponentProps<"form">, "onSubmit"> & {
		form: FormState<S>;
		disabled?: boolean;
		fieldsetClass?: string;
		/** @defaultValue `true` */
		guardBeforeLeave?: boolean;
	},
) {
	const [_, formProps] = splitProps(props, [
		"form",
		"guardBeforeLeave",
		"fieldsetClass",
	]);

	useBeforeLeave((e) => {
		if (props.guardBeforeLeave === false) return;
		if (props.form.isDirty && !props.form.isSubmitting && !e.defaultPrevented) {
			// preventDefault to block immediately and prompt user async
			e.preventDefault();
			setTimeout(() => {
				if (window.confirm("Discard unsaved changes - are you sure?")) {
					// user wants to proceed anyway so retry with force=true
					e.retry(true);
				}
			}, 100);
		}
	});

	return (
		<form
			{...formProps}
			onSubmit={(e) => {
				e.preventDefault();
				e.stopPropagation();
				void props.form.onSubmit();
			}}
		>
			{/* This is a hack to trick Safari into not asking to save the password to keychain */}
			<Show when={props.autocomplete === "off"}>
				<input
					type="password"
					id="fakePassword"
					style="border: 0; width: 10px; height: 10px; background-color: red; opacity: 0; position: absolute; bottom: 0px; left: 0px"
					tabIndex="-1"
					aria-disabled="true"
				/>
			</Show>

			<fieldset
				disabled={
					props.form.isSubmitting || props.form.isDisabled || props?.disabled
				}
				class={props.fieldsetClass}
			>
				{props.children}
			</fieldset>
		</form>
	);
}
