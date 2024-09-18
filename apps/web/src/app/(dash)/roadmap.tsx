import { BreadcrumbItem } from "@mattrax/ui";
import clsx from "clsx";
import { For, Show } from "solid-js";
import { Page } from "~/components/Page";

export default function () {
	return (
		<Page
			title="Roadmap"
			breadcrumbs={[<BreadcrumbItem>Roadmap</BreadcrumbItem>]}
			class="p-4 max-w-xl"
		>
			<div class="relative pl-6 after:absolute after:inset-y-0 after:left-0 after:w-px after:bg-muted-foreground/20">
				<div class="grid gap-6">
					<For each={Object.entries(roadmap)}>
						{([title, section]) => (
							<div class="grid gap-1 text-sm relative">
								<div
									class={clsx(
										"aspect-square w-3 rounded-full absolute left-0 translate-x-[-29.5px] z-10 top-2",
										Object.values(section.items).every(
											(status) => status === "done",
										)
											? "bg-green-500"
											: Object.values(section.items).some(
														(status) => status === "progress",
													)
												? "bg-orange-500"
												: "bg-muted-foreground",
									)}
								/>
								<div class="font-medium text-xl">{title}</div>
								<Show when={section.description}>
									{(description) => (
										<div class="text-md text-zinc-500 dark:text-zinc-400">
											{description()}
										</div>
									)}
								</Show>
								<ul class="flex flex-col space-y-1 list-disc pl-2 ml-2">
									<For each={Object.entries(section.items)}>
										{([item, status]) => (
											<li
												class={clsx(
													"text-sm text-zinc-500 dark:text-zinc-400 font-light",
													status === "done"
														? "line-through marker:text-green-500"
														: status === "progress"
															? "italic marker:text-orange-500"
															: "",
												)}
											>
												{item}
											</li>
										)}
									</For>
								</ul>
							</div>
						)}
					</For>
				</div>
			</div>
		</Page>
	);
}

type Status = "none" | "progress" | "done";
type RoadmapSection = {
	description?: string;
	items: Record<string, Status>;
};

const roadmap: Record<string, RoadmapSection> = {
	"Alpha launch": {
		items: {
			"Basic account and tenant management": "done",
			"Blueprint management & Device overview": "progress",
			"Basic Windows management": "none",
			"Improve sidebar with mobile support & minimise": "none",
			"Analytics and error tracking": "none",
		},
	},
	// Beta launch
	Cleanup: {
		description: "Cleanup major missing functionality from the alpha launch.",
		items: {
			"Implement tenant delete": "none",
			"Implement account delete": "none",
			"Multiple administrators with access to a single tenant": "none",
			"Improve login process": "none",
			"Global Search (Cmd + K) & Keyboard navigation": "none",
		},
	},
	"Extended management": {
		items: {
			"macOS Management": "none",
			"Android Management": "none",
			"Application management": "none",
			"Run bash and batch scripts on devices": "none",
			"Custom attributes": "none",
		},
	},
	Composability: {
		items: {
			"Apply policies in the user vs device scope": "none",
			Policies: "none",
			Groups: "none",
			"Manage policy versions": "none",
		},
	},
	Users: {
		items: {
			"AzureAD integration": "none",
			"Google Workspaces integration": "none",
			"Active Directory integration": "none",
			"SAML integration": "none",
			"User-initiated enrollment": "none",
		},
	},
	// v1 Launch
	"Self-service self hosting": {
		items: {
			"Support self-hosted": "none",
			Updater: "none",
			"Deployment Guide": "none",
		},
	},
};
