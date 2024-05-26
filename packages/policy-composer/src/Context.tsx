import { type ParentProps, Show, createContext, useContext } from "solid-js";
import { createStore } from "solid-js/store";

export type PolicyPlatform = "windows" | "apple";

export function createPolicyComposerController(platform: PolicyPlatform) {
	const [state, setState] = createStore<{
		platform: PolicyPlatform;
		windows: Record<string, Record<string, { enabled: boolean; data: any }>>;
		apple: Record<
			string,
			{ enabled: boolean; data: Array<Record<string, any>>; open: boolean }
		>;
	}>({ platform, windows: {}, apple: {} });

	return { state, setState };
}

export type PolicyComposerController = ReturnType<
	typeof createPolicyComposerController
>;

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
