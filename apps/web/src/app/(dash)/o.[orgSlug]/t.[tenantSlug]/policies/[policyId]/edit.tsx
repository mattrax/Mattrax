import {
	PolicyComposer,
	createPolicyComposerController,
} from "@mattrax/policy-composer";
import { createContentEditableController } from "@mattrax/ui/lib";

import { createAsync } from "@solidjs/router";
import { Show, createSignal } from "solid-js";
import { useFeatures } from "~/lib/featureFlags";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import { PolicyContext, usePolicy } from "./Context";

export default function Page() {
	const policy = () => usePolicy()();
	const [policyName, setPolicyName] = createSignal("./policy.yaml");
	const policyNameController = createContentEditableController(setPolicyName);
	const controller = createPolicyComposerController();

	const windowsPolicies = createAsync(() =>
		import("@mattrax/configuration-schemas/windows/ddf.json?raw").then(
			({ default: str }) => JSON.parse(str),
		),
	);
	const applePayloads = createAsync(() =>
		import("@mattrax/configuration-schemas/apple/payloads.json?raw").then(
			({ default: str }) => JSON.parse(str),
		),
	);

	return (
		<PolicyContext>
			<PolicyComposer
				windowsCSPs={windowsPolicies()}
				applePayloads={applePayloads()}
				controller={controller}
			/>
		</PolicyContext>
	);
}
