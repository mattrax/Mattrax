import {
	type Accessor,
	type ParentProps,
	Show,
	createContext,
	useContext,
} from "solid-js";
import { createStore } from "solid-js/store";

export function createPolicyComposerController() {
	const [selected, setSelected] = createStore<{
		windows: Record<string, Record<string, { enabled: boolean; data: any }>>;
		apple: Record<
			string,
			{ enabled: boolean; data: Record<string, any>; open?: boolean }
		>;
	}>({ windows: {}, apple: {} });

	return { selected, setSelected };
}

export type VisualEditorController = ReturnType<
	typeof createPolicyComposerController
>;

const ControllerContext = createContext<VisualEditorController>(null!);

export function ControllerProvider(
	props: ParentProps<{ controller: VisualEditorController }>,
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
			"useComposerContext must be used within a PolicyComposerProvider",
		);
	}

	return ctx;
}
