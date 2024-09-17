import { For } from "solid-js";
import { Page } from "~/components/Page";
import { trpc } from "~/lib";
import { useTenantStats } from "~/lib/data";

export default function () {
	// const tenantSlug = useTenantSlug();
	// const stats = useTenantStats(tenantSlug());

	return (
		<Page title="Overview" breadcrumbs={[]}>
			<div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
				<For each={Array.from({ length: 4 })}>
					{() => (
						<div class="rounded-xl border bg-card text-card-foreground shadow">
							<div class="p-6 flex flex-row items-center justify-between space-y-0 pb-2">
								<h3 class="tracking-tight text-sm font-medium">
									Total Revenue
								</h3>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									class="h-4 w-4 text-muted-foreground"
								>
									<title>TODO</title>
									<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
								</svg>
							</div>
							<div class="p-6 pt-0">
								<div class="text-2xl font-bold">$45,231.89</div>
								{/* <p class="text-xs text-muted-foreground">+20.1% from last month</p> */}
							</div>
						</div>
					)}
				</For>
			</div>
		</Page>
	);
}
