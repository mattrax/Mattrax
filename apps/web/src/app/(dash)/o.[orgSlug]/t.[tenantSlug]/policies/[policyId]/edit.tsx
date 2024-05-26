import {
	PolicyComposer,
	type PolicyPlatform,
	createPolicyComposerController,
} from "@mattrax/policy-composer";
import { createContentEditableController } from "@mattrax/ui/lib";

import { createAsync, useSearchParams } from "@solidjs/router";
import { Show, createEffect, createSignal } from "solid-js";
import { useFeatures } from "~/lib/featureFlags";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import { PolicyContext, usePolicy } from "./Context";

export default function Page() {
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

	const policy = () => usePolicy()();

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
		<PolicyContext>
			<PolicyComposer
				windowsCSPs={windowsPolicies()}
				applePayloads={applePayloads()}
				controller={controller}
			/>
		</PolicyContext>
	);
}
