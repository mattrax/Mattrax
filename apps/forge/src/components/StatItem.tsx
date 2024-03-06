import Counter from "./Counter";

export function StatItem(props: { title: string; value: number }) {
	return (
		<div class="rounded-lg bg-gray-100 dark:bg-brandDark px-4 py-5 shadow sm:p-6">
			<span class="truncate text-sm font-medium ">{props.title}</span>
			<Counter value={props.value} duration={1700}>
				{(count) => (
					<dd class="mt-1 text-3xl font-semibold tracking-tight">
						{count().toLocaleString()}
					</dd>
				)}
			</Counter>
		</div>
	);
}
