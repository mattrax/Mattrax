import {
	CommandDialog,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@mattrax/ui";
import { createEventListener } from "@solid-primitives/event-listener";
import { ReactiveMap } from "@solid-primitives/map";
import { useHref, useNavigate, useResolvedPath } from "@solidjs/router";
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
	createEffect,
} from "solid-js";

type Action = {
	title: string;
	disabled?: boolean;
} & (
	| { href: string | (() => string) }
	| { onClick: () => void; onMetaClick?: () => void; onHover?: () => void }
);

const Context = createContext<
	ReactiveMap<
		string,
		{
			category: string;
			actions: Action[];
		}
	>
>(undefined!);

export default function CommandPaletteProvider(props: ParentProps) {
	const [open, setOpen] = createSignal(false);
	const navigate = useNavigate();

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
													{(action) => {
														const href = () =>
															"href" in action
																? typeof action.href === "function"
																	? action.href()
																	: action.href
																: undefined;

														return (
															<CommandItem
																as={href() ? "a" : "div"}
																href={href()}
																value={`${category.category}|${action.title}`}
																aria-disabled={action.disabled}
																disabled={action.disabled}
																// @ts-expect-error: We patch this into `solid-cmdk`
																onSelect={(_, e) => {
																	if (action.disabled || e.metaKey) return;
																	if ("onClick" in action) action.onClick();
																	if ("href" in action) navigate(href()!);
																	setOpen(false);
																}}
															>
																<span>{action.title}</span>
															</CommandItem>
														);
													}}
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
	const ctx = useContext(Context);
	if (!ctx) throw new Error("`CommandPaletteProvider` not found in the tree.");

	// My thinking is this effect will contain the `useResolvedPath` and `useHref` so we don't have a memory leak but idk if that's true.
	createEffect(() => {
		ctx.set(id, {
			category,
			actions: actions.map((action) => {
				// const href: string | (() => string) | undefined = undefined;
				if ("href" in action) {
					const to = useResolvedPath(() =>
						typeof action.href === "function" ? action.href() : action.href,
					);
					const resolvedHref = useHref(to);
					action.href = () => resolvedHref()!;
				}

				return action;
			}),
		});
		onCleanup(() => ctx.delete(id));
	});
}
