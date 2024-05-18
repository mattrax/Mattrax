import { createContentEditableController } from "@mattrax/ui/lib";
import {
	PolicyComposer,
	createPolicyComposerController,
} from "@mattrax/policy-composer";

import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import { PolicyContext, usePolicy } from "./Context";
import { createSignal, Show } from "solid-js";
import { useFeatures } from "~/lib/featureFlags";
import { createAsync } from "@solidjs/router";

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
			<Show when={windowsPolicies() && applePayloads()}>
				<PolicyComposer
					windowsCSPs={windowsPolicies() as any}
					applePayloads={applePayloads() as any}
					controller={controller}
				/>
			</Show>
		</PolicyContext>
	);
}
