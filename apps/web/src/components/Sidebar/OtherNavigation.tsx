import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
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
	) => (
		<li>
			<a
				href={href}
				target="_blank"
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

	return (
		<ul class="grid gap-0.5">
			{item("Documentation", "https://mattrax.app/docs/", IconPhFiles)}
			<Dialog open={open()} onOpenChange={setOpen}>
				<DialogTrigger as="li">
					<button
						type="button"
						class="flex h-7 items-center gap-2.5 overflow-hidden rounded-md px-1.5 text-xs ring-zinc-950 transition-all hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 dark:ring-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50 w-full text-start"
					>
						<IconLucideSend class="h-4 w-4 shrink-0 translate-x-0.5 text-zinc-500 dark:text-zinc-400" />
						<div class="line-clamp-1 grow overflow-hidden pr-6 font-medium text-zinc-500 dark:text-zinc-400">
							Feedback
						</div>
					</button>
				</DialogTrigger>
				<DialogContent>
					<FeedbackDialogBody close={() => setOpen(false)} />
				</DialogContent>
			</Dialog>

			{item("Support", "mailto:hello@mattrax.app", IconLucideLifeBuoy)}
		</ul>
	);
}

function FeedbackDialogBody(props: { close: () => void }) {
	const matches = useCurrentMatches();
	const sendFeedback = trpc.meta.sendFeedback.createMutation();
	const [content, setContent] = createSignal("");

	const getPath = () => {
		const m = matches();
		if (m.length === 0) return undefined;
		return m[m.length - 1]!.path;
	};

	return (
		<>
			<DialogHeader>
				<DialogTitle>Tell us how we can improve!</DialogTitle>
				<DialogDescription>
					We welcome feedback of any kind so we can improve Mattrax!
				</DialogDescription>

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
						props.close();
					}}
					disabled={sendFeedback.isPending}
					size="sm"
				>
					Submit
				</Button>
			</DialogHeader>
		</>
	);
}
