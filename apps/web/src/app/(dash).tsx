import { Navigate } from "@solidjs/router";
import { parse } from "cookie-es";
import { Suspense, type ParentProps, ErrorBoundary } from "solid-js";
import { z } from "zod";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
	SidebarItem,
	SidebarLabel,
	SidebarLayout,
} from "~/components/Sidebar";
import { Footer } from "~/components/Sidebar/Footer";
import { Navigation } from "~/components/Sidebar/Navigation";
import { OtherNavigation } from "~/components/Sidebar/OtherNavigation";
import { TenantSwitcher } from "~/components/Sidebar/TenantSwitcher";
import { useTenants } from "~/lib/data";
import { useZodParams } from "~/lib/useZodParams";

export const useTenantId = () => {
	const params = useZodParams({
		tenantId: z.string(),
	});
	return () => params.tenantId;
};

export default function (props: ParentProps) {
	const params = useZodParams({
		// This is optional as the sidebar should be available on `/account`, etc
		tenantId: z.string().optional(),
	});

	// If unauthenticated send to login
	// It's *super important* this is in the layout, not the child because the children are lazy loaded.
	if (parse(document.cookie).isLoggedIn !== "true") {
		return <Navigate href="/login" />;
	}

	const tenants = useTenants();

	return (
		<SidebarLayout>
			<Sidebar>
				<SidebarHeader>
					<TenantSwitcher />
				</SidebarHeader>
				<SidebarContent>
					<SidebarItem>
						{/* <SidebarLabel>Platform</SidebarLabel> */}
						<Navigation
							tenantId={params.tenantId}
							disabled={
								params.tenantId === undefined || tenants.data === undefined
							}
						/>
					</SidebarItem>
					<SidebarItem class="mt-auto">
						<SidebarLabel>Other</SidebarLabel>
						<OtherNavigation />
					</SidebarItem>
				</SidebarContent>
				<SidebarFooter>
					<Footer />
				</SidebarFooter>
			</Sidebar>
			<div class="p-4 min-h-screen h-screen overflow-auto">
				<ErrorBoundary fallback={ErrorScreen}>
					<Suspense>{props.children}</Suspense>
				</ErrorBoundary>
			</div>
		</SidebarLayout>
	);
}

function ErrorScreen(err: Error, reset: () => void) {
	console.error(err);

	return (
		<div class="flex h-full items-center justify-center">
			<div class="flex flex-col items-center justify-center">
				<h1 class="mt-4 text-3xl font-bold tracking-tight text-gray-900 sm:text-5xl">
					Error occurred
				</h1>
				<p class="text-muted-foreground opacity-70 pt-2 text-md text-center max-w-sm">
					We are sorry but something has gone wrong!
				</p>

				<pre class="text-muted-foreground opacity-70 p-2">{err.toString()}</pre>

				<p class="text-muted-foreground opacity-70 text-sm text-center max-w-sm">
					<a
						href={`mailto:hello@mattrax.app?subject=${encodeURIComponent("Something went wrong!")}&body=${encodeURIComponent(`I encountered the following error while using the Mattrax dashboard.\n\n${err.toString()}\n\nPlease include steps to reproduce this before sending the email!`)}`}
						class="underline underline-offset-2 hover:text-black"
					>
						Need help?
					</a>
				</p>
			</div>
		</div>
	);
}
