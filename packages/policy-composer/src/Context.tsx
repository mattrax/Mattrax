import type { PolicyData } from "@mattrax/policy";
import { type ParentProps, Show, createContext, useContext } from "solid-js";
import type { SetStoreFunction } from "solid-js/store";

export type PolicyPlatform = "windows" | "apple" | "android";

export type PolicyComposerState = {
	filter: boolean;
	platform: PolicyPlatform;
	windows?: Record<
		string,
		{ enabled: boolean; data: PolicyData["windows"][string]; open: boolean }
	>;
	apple?: Record<
		string,
		{
			enabled: boolean;
			data: PolicyData["macos"][string];
			open: boolean;
		}
	>;
};

export type PolicyComposerController = {
	state: PolicyComposerState;
	setState: SetStoreFunction<PolicyComposerState>;
	onSave?: () => Promise<any>;
	onDeploy?: () => Promise<any>;
};

const ControllerContext = createContext<PolicyComposerController>(null!);

export function ControllerProvider(
	props: ParentProps<{ controller: PolicyComposerController }>,
) {
	return (
		<Show when={props.controller} keyed>
			{(controller) => (
				<ControllerContext.Provider value={controller}>
					{props.children}
				</ControllerContext.Provider>
			)}
		</Show>
	);
}

export function useController() {
	const ctx = useContext(ControllerContext);

	if (!ctx) {
		throw new Error(
			"useController must be used within a PolicyComposerProvider",
		);
	}

	return ctx;
}
