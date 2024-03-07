import { useNavigate } from "@solidjs/router";
import {
	ErrorBoundary,
	ParentProps,
	Show,
	Suspense,
	startTransition,
} from "solid-js";

import { Button } from "~/components/ui";
import TopNav from "./[tenantSlug]/TopNav";
import { BreadcrumbsRoot } from "~/components/Breadcrumbs";
import { TenantContext, useTenant } from "./TenantContext";
import { AuthContext } from "./AuthContext";

export default function Layout(props: ParentProps) {
	const navigate = useNavigate();

	function setTenantSlug(slug: string) {
		startTransition(() => navigate(`../${slug}`));
	}

	return (
		<BreadcrumbsRoot>
			<TopNav setActiveTenant={setTenantSlug} />
			<AuthContext>
				<TenantContext>
					{/* we don't key the sidebar so that the tenant switcher closing animation can still play */}
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
						<Show when={useTenant()().id} keyed>
							<Suspense>{props.children}</Suspense>
						</Show>
					</ErrorBoundary>
				</TenantContext>
			</AuthContext>
		</BreadcrumbsRoot>
	);
}
