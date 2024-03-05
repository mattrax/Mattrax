import { createContextProvider } from "@solid-primitives/context";
import { Navigate, useNavigate } from "@solidjs/router";
import {
	ErrorBoundary,
	ParentProps,
	Show,
	Suspense,
	createMemo,
	startTransition,
} from "solid-js";
import { z } from "zod";
import { RouterOutput } from "~/api/trpc";

import { Button } from "~/components/ui";
import { SuspenseError } from "~/lib";
import { useZodParams } from "~/lib/useZodParams";
import { useAuth as useAuth } from "~/app/(dash)";
import TopNav from "./[tenantSlug]/TopNav";

export const [TenantContextProvider, useTenant] = createContextProvider(
	(props: {
		tenant: RouterOutput["auth"]["me"]["tenants"][number];
	}) =>
		() =>
			props.tenant,
	null!,
);

export default function Layout(props: ParentProps) {
	const params = useZodParams({ tenantSlug: z.string() });
	const auth = useAuth();
	const navigate = useNavigate();

	const activeTenant = createMemo(() =>
		auth().tenants.find((t) => t.slug === params.tenantSlug),
	);

	function setTenantSlug(slug: string) {
		startTransition(() => navigate(`../${slug}`));
	}

	return (
		<Show
			when={activeTenant()}
			fallback={
				<Navigate
					href={() => {
						const firstTenant = auth().tenants[0];
						return firstTenant?.slug ? `../${firstTenant.slug}` : "/";
					}}
				/>
			}
		>
			{(activeTenant) => (
				<TenantContextProvider tenant={activeTenant()}>
					{/* we don't key the sidebar so that the tenant switcher closing animation can still play */}
					<Suspense fallback={<SuspenseError name="Sidebar" />}>
						<TopNav
							setActiveTenant={setTenantSlug}
							refetchSession={async () => {
								await auth.query.refetch();
							}}
						/>
					</Suspense>
					<ErrorBoundary
						fallback={(err, reset) => (
							<div class="flex flex-col items-center justify-center h-full gap-4">
								<h1 class="text-3xl font-semibold">An error occurred!</h1>
								<p class="text-gray-600 max-w-4xl">{err.toString()}</p>
								<Button onClick={reset}>Reload</Button>
							</div>
						)}
					>
						{/* we key here on purpose - tenants are the root-most unit of isolation */}
						<Show when={activeTenant().id} keyed>
							{props.children}
						</Show>
					</ErrorBoundary>
				</TenantContextProvider>
			)}
		</Show>
	);
}
