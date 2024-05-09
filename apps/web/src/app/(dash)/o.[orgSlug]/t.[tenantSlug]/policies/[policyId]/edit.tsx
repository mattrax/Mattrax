import windowsPolicies from "@mattrax/configuration-schemas/windows/ddf.json";
import applePayloads from "@mattrax/configuration-schemas/apple/payloads.json";
import { createContentEditableController } from "@mattrax/ui/lib";
import {
	PolicyComposer,
	createPolicyComposerController,
} from "@mattrax/policy-composer";

import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import { PolicyContext, usePolicy } from "./Context";
import { createSignal, Show } from "solid-js";
import { useFeatures } from "~/lib/featureFlags";

export default function Page() {
	const policy = () => usePolicy()();
	const [policyName, setPolicyName] = createSignal("./policy.yaml");
	const policyNameController = createContentEditableController(setPolicyName);
	const controller = createPolicyComposerController();

	return (
		<PolicyContext>
			<PolicyComposer
				windowsCSPs={windowsPolicies as any}
				applePayloads={applePayloads as any}
				controller={controller}
			/>
		</PolicyContext>
	);
}
