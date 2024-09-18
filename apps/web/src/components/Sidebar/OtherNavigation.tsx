import {
	Button,
	Popover,
	PopoverContent,
	PopoverTrigger,
	Textarea,
} from "@mattrax/ui";
import { useCurrentMatches } from "@solidjs/router";
import { type JSX, createSignal } from "solid-js";
import { trpc } from "~/lib";

export function OtherNavigation() {
	const item = (
		title: string,
		href: string,
		Icon: (props: { class: string }) => JSX.Element,
		newTab?: boolean,
	) => (
		<li>
			<a
				href={href}
				target={newTab === false ? undefined : "_blank"}
				rel="noopener noreferrer"
				class="flex h-7 items-center gap-2.5 overflow-hidden rounded-md px-1.5 text-xs ring-zinc-950 transition-all hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 dark:ring-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
			>
				<Icon class="h-4 w-4 shrink-0 translate-x-0.5 text-zinc-500 dark:text-zinc-400" />
				<div class="line-clamp-1 grow overflow-hidden pr-6 font-medium text-zinc-500 dark:text-zinc-400">
					{title}
				</div>
			</a>
		</li>
	);

	const [open, setOpen] = createSignal(false);
	const matches = useCurrentMatches();
	const sendFeedback = trpc.meta.sendFeedback.createMutation();
	const [content, setContent] = createSignal("");

	const getPath = () => {
		const m = matches();
		if (m.length === 0) return undefined;
		return m[m.length - 1]!.path;
	};

	return (
		<ul class="grid gap-0.5">
			{item("Documentation", "https://mattrax.app/docs/", IconPhFiles)}
			<li>
				<Popover
					open={open()}
					onOpenChange={(state) => {
						if (!open() && state) setContent("");

						if (open() && !state && content() !== "") {
							const result = confirm(
								"Are you sure you want to discard your feedback?",
							);
							if (!result) return;
						}
						setOpen(state);
					}}
					placement="right-end"
				>
					<PopoverTrigger
						as="button"
						type="button"
						class="flex h-7 items-center gap-2.5 overflow-hidden rounded-md px-1.5 text-xs ring-zinc-950 transition-all hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 dark:ring-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50 w-full text-start"
					>
						<IconLucideSend class="h-4 w-4 shrink-0 translate-x-0.5 text-zinc-500 dark:text-zinc-400" />
						<div class="line-clamp-1 grow overflow-hidden pr-6 font-medium text-zinc-500 dark:text-zinc-400">
							Feedback
						</div>
					</PopoverTrigger>
					<PopoverContent class="p-4 flex flex-col space-y-2">
						<h1 class="text-lg font-semibold leading-none tracking-tight">
							Submit Feedback
						</h1>
						<p class="text-muted-foreground text-sm">
							We welcome feedback to help us improve Mattrax!
						</p>

						<Textarea
							value={content()}
							onInput={(e) => setContent(e.target.value)}
							disabled={sendFeedback.isPending}
						/>

						<Button
							type="button"
							class="w-full"
							onClick={async () => {
								sendFeedback.mutateAsync({
									content: content(),
									path: getPath(),
								});
								setOpen(false);
							}}
							disabled={sendFeedback.isPending}
							size="sm"
						>
							Submit
						</Button>
					</PopoverContent>
				</Popover>
			</li>

			{item("Support", "mailto:hello@mattrax.app", IconLucideLifeBuoy)}
			{item("Roadmap", "/roadmap", IconPhMapTrifold, false)}
		</ul>
	);
}
