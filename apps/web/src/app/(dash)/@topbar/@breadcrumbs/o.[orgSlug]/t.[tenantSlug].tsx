import { Button } from "@mattrax/ui";
import {
	A,
	RouteSectionProps,
	useMatch,
	useResolvedPath,
} from "@solidjs/router";
import { Show } from "solid-js";
import { z } from "zod";

import { useZodParams } from "~/lib/useZodParams";
import IconPhCaretUpDown from "~icons/ph/caret-up-down.jsx";
import { trpc } from "~/lib";
import { createQueryCacher, useCachedQueryData } from "~/cache";
import { MultiSwitcher } from "../MultiSwitcher";
import { cachedTenantsForOrg } from "~[orgSlug]/utils";
import { cachedOrgs } from "~dash/utils";
import { Breadcrumb } from "../Breadcrumb";

export default function (props: RouteSectionProps) {
	const params = useZodParams({
		orgSlug: z.string(),
		tenantSlug: z.string(),
	});

	const query = trpc.org.list.createQuery();
	const orgs = useCachedQueryData(query, () => cachedOrgs());
	const org = () => orgs()?.find((o) => o.slug === params.orgSlug);

	return (
		<>
			<Breadcrumb>
				<Show when={org()}>
					{(org) => {
						const query = trpc.tenant.list.createQuery(() => ({
							orgSlug: params.orgSlug,
						}));
						createQueryCacher(query, "tenants", (t) => ({ ...t }));
						const tenants = useCachedQueryData(query, () =>
							cachedTenantsForOrg(org().id),
						);

						const tenant = () =>
							tenants()?.find((t) => t.slug === params.tenantSlug);

						const base = useResolvedPath(() => "");
						const match = useMatch(() => `${base()}/:segment/:subSegment/*`);

						return (
							<div class="flex flex-row items-center py-1 gap-2">
								<A href={match()?.params.segment ?? ""}>{tenant()?.name}</A>
								<MultiSwitcher>
									<Button variant="ghost" size="iconSmall">
										<IconPhCaretUpDown class="h-5 w-5 -mx-1" />
									</Button>
								</MultiSwitcher>
							</div>
						);
					}}
				</Show>
			</Breadcrumb>
			{props.children}
		</>
	);
}
