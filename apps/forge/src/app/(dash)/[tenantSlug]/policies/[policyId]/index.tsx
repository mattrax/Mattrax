import { z } from "zod";
import { useTenant } from "~/app/(dash)/[tenantSlug]";
import { Form, InputField, createZodForm } from "~/components/forms";
import { Button, Label } from "~/components/ui";
import { trpc } from "~/lib";
import { useZodParams } from "~/lib/useZodParams";
import { PageLayout, PageLayoutHeading } from "../../PageLayout";

export default function Page() {
	const params = useZodParams({
		policyId: z.string(),
	});
	const tenant = useTenant();
	const policy = trpc.policy.get.useQuery(() => ({
		policyId: params.policyId,
		tenantSlug: tenant().slug,
	}));

	return (
		<PageLayout heading={<PageLayoutHeading>Overview</PageLayoutHeading>}>
			<p>Hello</p>
		</PageLayout>
	);
}
