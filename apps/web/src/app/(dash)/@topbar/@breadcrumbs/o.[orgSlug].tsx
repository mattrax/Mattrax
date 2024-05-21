import { Button } from "@mattrax/ui";
import { A, RouteSectionProps } from "@solidjs/router";
import { z } from "zod";

import { createQueryCacher, useCachedQueryData } from "~/cache";
import IconPhCaretUpDown from "~icons/ph/caret-up-down.jsx";
import { MultiSwitcher } from "./MultiSwitcher";
import { useZodParams } from "~/lib/useZodParams";
import { cachedOrgs } from "../../utils";
import { trpc } from "~/lib";
import { Breadcrumb } from "./Breadcrumb";

export default function (props: RouteSectionProps) {
	const params = useZodParams({ orgSlug: z.string() });

	const query = trpc.org.list.createQuery();
	createQueryCacher(query, "orgs", (org) => ({
		id: org.id,
		name: org.name,
		slug: org.slug,
	}));
	const orgs = useCachedQueryData(query, () => cachedOrgs());

	const org = () => orgs()?.find((o) => o.slug === params.orgSlug);

	return (
		<>
			<Breadcrumb>
				<div class="flex flex-row items-center py-1 gap-2">
					<A href="">{org()?.name}</A>
					<MultiSwitcher>
						<Button variant="ghost" size="iconSmall">
							<IconPhCaretUpDown class="h-5 w-5 -mx-1" />
						</Button>
					</MultiSwitcher>
				</div>
			</Breadcrumb>
			{props.children}
		</>
	);
}
