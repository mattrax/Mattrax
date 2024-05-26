import { Avatar, AvatarFallback } from "@mattrax/ui";
import { createTimeAgo } from "@solid-primitives/date";
import { A } from "@solidjs/router";
import { For, Suspense } from "solid-js";
import { getInitials, trpc } from "~/lib";
import { formatAuditLogEvent } from "~/lib/formatAuditLog";
import { useTenantSlug } from "../../t.[tenantSlug]";

export default function Page() {
	const tenantSlug = useTenantSlug();
	const auditLog = trpc.tenant.auditLog.createQuery(() => ({
		tenantSlug: tenantSlug(),
	}));

	return (
		<div>
			<h1 class="text-2xl font-semibold">Audit log</h1>
			<p class="mt-2 mb-3 text-gray-700 text-sm">
				See all activity in the current tenant
			</p>
			<div class="flex flex-col gap-4 pl-4">
				<Suspense
					fallback={<p class="text-muted-foreground opacity-70">Loading...</p>}
				>
					<For
						each={auditLog.data}
						fallback={
							<p class="text-muted-foreground opacity-70">No activity!</p>
						}
					>
						{(entry) => {
							const formatted = formatAuditLogEvent(
								entry.action,
								entry.data as any,
							);
							if (formatted === null) return null;

							const [timeago] = createTimeAgo(entry.doneAt);

							const inner = (
								<p class="text-sm font-medium leading-none">
									{formatted.title}
								</p>
							);

							return (
								<div class="flex justify-between">
									<div class="flex items-center">
										<Avatar class="h-9 w-9">
											{/* TODO: Finish this */}
											{/* <AvatarImage src="/avatars/01.png" alt="Avatar" /> */}
											<AvatarFallback>{getInitials(entry.user)}</AvatarFallback>
										</Avatar>
										<div class="ml-4 space-y-1">
											{formatted.href ? (
												<A
													href={`../../${formatted.href}`}
													class="underline-offset-2 hover:underline"
												>
													{inner}
												</A>
											) : (
												inner
											)}
											<p class="text-sm text-muted-foreground">
												{entry.user} - {timeago()}
											</p>
										</div>
									</div>
								</div>
							);
						}}
					</For>
				</Suspense>
			</div>
		</div>
	);
}
