import { Card, CardContent, CardHeader, CardTitle, Label } from "@mattrax/ui";
import { Switch, Match, Suspense, type JSX, Show } from "solid-js";
import { A } from "@solidjs/router";

import { createCounter } from "./Counter";

export function StatItem(
	props: {
		title: string;
		href: string;
		icon: JSX.Element;
	} & ({ value?: number } | { body: JSX.Element }),
) {
	return (
		<Card class="relative hover:shadow-md transition-shadow group">
			<CardHeader class="pb-2">
				<div class="flex flex-row items-center justify-between">
					<Label>
						<span class="group-hover:underline">{props.title}</span>
					</Label>

					{props.icon}
				</div>
			</CardHeader>
			<CardContent>
				<div class="text-2xl font-bold">
					<Switch>
						<Match when={"value" in props && props} keyed>
							{(props) => {
								const fallback = (
									<>
										<span class="opacity-0">0</span>
										<div class="w-12 bg-neutral-200 animate-pulse absolute inset-y-0 rounded-full" />
									</>
								);

								return (
									<dd class="mt-1 text-3xl font-semibold tracking-tight relative">
										<Suspense fallback={fallback}>
											<Show
												when={props.value !== undefined}
												fallback={fallback}
											>
												{(_) => {
													const counter = createCounter(() => ({
														value: props.value!,
														duration: 1700,
													}));

													return <>{counter().toLocaleString()}</>;
												}}
											</Show>
										</Suspense>
									</dd>
								);
							}}
						</Match>
						<Match when={"body" in props && props} keyed>
							{(props) => props.body}
						</Match>
					</Switch>
				</div>
			</CardContent>
			<A class="absolute inset-0" href={props.href} />
		</Card>
	);
}
