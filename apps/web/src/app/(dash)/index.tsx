import { Navigate } from "@solidjs/router";
import { Show, Suspense } from "solid-js";
import { useAccount, useTenants } from "~/lib/data";

export default function () {
	useAccount();
	const tenants = useTenants();

	// The layout will handle redirecting unauthenticated users to login

	return (
		<Suspense
			fallback={
				<div class="flex h-full items-center justify-center">
					<div class="flex flex-col items-center justify-center">
						<IconSvgSpinners90Ring class="w-10 h-10" />
						<p class="text-muted-foreground opacity-70 pt-2 text-sm">
							Loading {tenants.isLoading ? "tenants" : "account"}...
						</p>
					</div>
				</div>
			}
		>
			{/* Send to first tenant or create new tenant */}
			<Show when={tenants.data} keyed>
				{(tenants) => <Navigate href={`/t/${tenants[0]?.id || "new"}`} />}
			</Show>
		</Suspense>
	);
}
