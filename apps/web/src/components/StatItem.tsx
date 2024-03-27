import { Card, CardContent, CardHeader, CardTitle } from "@mattrax/ui";
import { A } from "@solidjs/router";
import type { JSX } from "solid-js";
import Counter from "./Counter";

export function StatItem(
	props: {
		title: string;
		href: string;
		icon: JSX.Element;
	} & (
		| {
				value: number;
		  }
		| {
				body: JSX.Element;
		  }
	),
) {
	return (
		<Card class="relative hover:shadow-md transition-shadow">
			<CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
				<CardTitle class="text-sm font-medium">
					<span class="hover:underline">{props.title}</span>
				</CardTitle>

				{props.icon}
			</CardHeader>
			<CardContent>
				<div class="text-2xl font-bold">
					{"value" in props ? (
						<Counter value={props.value} duration={1700}>
							{(count) => (
								<dd class="mt-1 text-3xl font-semibold tracking-tight">
									{count().toLocaleString()}
								</dd>
							)}
						</Counter>
					) : (
						props.body
					)}
				</div>
			</CardContent>
			<A class="absolute inset-0" href={props.href} />
		</Card>
	);
}
