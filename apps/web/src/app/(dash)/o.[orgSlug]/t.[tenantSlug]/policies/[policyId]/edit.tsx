import {
	PolicyComposer,
	type PolicyPlatform,
	createPolicyComposerController,
} from "@mattrax/policy-composer";
import { createContentEditableController } from "@mattrax/ui/lib";

import { createAsync, useSearchParams } from "@solidjs/router";
import { createEffect, createSignal } from "solid-js";
import { trpc } from "~/lib";
import { usePolicyId } from "../[policyId]";
import { usePolicy } from "./Context";

const windowsPoliciesPromise = import(
	"@mattrax/configuration-schemas/windows/ddf.json?raw"
).then(({ default: str }) => JSON.parse(str));

const applePayloadsPromise = import(
	"@mattrax/configuration-schemas/apple/payloads.json?raw"
).then(({ default: str }) => JSON.parse(str));

export default function Page() {
	const windowsPolicies = createAsync(() => windowsPoliciesPromise);
	const applePayloads = createAsync(() => applePayloadsPromise);

	const policyId = usePolicyId();

	const policy = () => usePolicy()();

	const updatePolicy = trpc.policy.update.createMutation();

	const [searchParams, setSearchParams] = useSearchParams<{
		platform: PolicyPlatform;
	}>();
	const controller = createPolicyComposerController(
		searchParams.platform ?? "windows",
	);

	createEffect(() => {
		setSearchParams({ platform: controller.state.platform });
	});

	return (
		// <PolicyContext>
		<PolicyComposer
			windowsCSPs={windowsPolicies()}
			applePayloads={applePayloads()}
			controller={controller}
			onSave={async () => {
				await updatePolicy.mutateAsync({
					id: policyId(),
					data: {
						windows: {},
						macos: Object.entries(controller.state.apple).reduce(
							(acc, [csp, { data, enabled }]) => {
								if (enabled) acc[csp] = data;
								return acc;
							},
							{} as Record<string, Array<Record<string, any>>>,
						),
						linux: null,
						android: null,
						scripts: [],
					},
				});
			}}
		/>
		// </PolicyContext>
	);
}
