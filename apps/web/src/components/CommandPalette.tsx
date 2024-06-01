import {
	CommandDialog,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@mattrax/ui";
import { createEventListener } from "@solid-primitives/event-listener";
import { ReactiveMap } from "@solid-primitives/map";
import { useNavigate } from "@solidjs/router";
import { useId } from "hono/jsx";
import {
	For,
	type ParentProps,
	Show,
	Suspense,
	createContext,
	createMemo,
	createSignal,
	onCleanup,
	useContext,
} from "solid-js";

type Action = Omit<BaseAction, "onClick"> &
	({ href: string } | { onClick: () => void });

type BaseAction = {
	title: string;
	disabled?: boolean;
	onClick: () => void;
};

const Context = createContext<
	ReactiveMap<
		string,
		{
			category: string;
			actions: BaseAction[];
		}
	>
>(undefined!);

export default function CommandPaletteProvider(props: ParentProps) {
	const [open, setOpen] = createSignal(false);

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
		<Context.Provider value={new ReactiveMap()}>
			<Suspense>
				<Show when>
					{(_) => {
						const ctx = useContext(Context);
						if (!ctx) throw new Error("Failed to get CommandPalette context");

						const entries = createMemo(() => {
							const entries = [...ctx.values()];

							// We squash all actions with the same category title into one.
							return entries.reduce((acc: typeof entries, curr) => {
								const { category, actions } = curr;
								const findObj = acc.find((o) => o.category === category);
								if (!findObj) {
									acc.push({ category, actions });
								} else {
									findObj.actions.push(...actions);
								}
								return acc;
							}, []);
						});

						return (
							<CommandDialog open={open()} onOpenChange={setOpen}>
								<CommandInput
									placeholder="Type a command or search..."
									autocomplete="off"
									spellcheck={false}
								/>
								<CommandList>
									<For each={entries()}>
										{(category) => (
											<CommandGroup heading={category.category}>
												<For each={category.actions}>
													{(action) => (
														<CommandItem
															aria-disabled={action.disabled}
															disabled={action.disabled}
															onSelect={() => {
																if (action.disabled) return;
																action.onClick();
																setOpen(false);
															}}
															value={`${category.category}|${action.title}`}
														>
															<span>{action.title}</span>
														</CommandItem>
													)}
												</For>
											</CommandGroup>
										)}
									</For>
								</CommandList>
							</CommandDialog>
						);
					}}
				</Show>
			</Suspense>

			{props.children}
		</Context.Provider>
	);
}

export function useCommandGroup(category: string, actions: Action[]) {
	const id = useId();
	const navigate = useNavigate();
	const ctx = useContext(Context);
	if (!ctx) throw new Error("`CommandPaletteProvider` not found in the tree.");
	ctx.set(id, {
		category,
		actions: actions.map((action) => {
			if ("href" in action) {
				// TODO: Command + click item that is a valid `A` to open in new tab
				// TODO: Prefetch route data on house hover or focus active
				return {
					...action,
					onClick: () => navigate(action.href),
				};
			}

			return action;
		}),
	});
	onCleanup(() => ctx.delete(id));
}
