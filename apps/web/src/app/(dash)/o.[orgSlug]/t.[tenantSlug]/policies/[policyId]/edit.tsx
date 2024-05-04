import windowsPolicies from "@mattrax/configuration-schemas/windows/ddf.json";
import applePayloads from "@mattrax/configuration-schemas/apple/payloads.json";
import { createContentEditableController } from "@mattrax/ui/lib";
import {
	PolicyComposer,
	createPolicyComposerController,
} from "@mattrax/policy-composer";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
	Tabs,
	TabsContent,
	TabsIndicator,
	TabsList,
	TabsTrigger,
} from "@mattrax/ui";

import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import { PolicyContext, usePolicy } from "./Context";
import { createSignal, Show } from "solid-js";
import { BruhIconPhArrowsVerticalBold } from "./bruh";
import { useFeatures } from "~/lib/featureFlags";

export default function Page() {
	const policy = () => usePolicy()();
	const [policyName, setPolicyName] = createSignal("./policy.yaml");
	const policyNameController = createContentEditableController(setPolicyName);
	const features = useFeatures();

	// TODO: Probs replace tabs with proper routes so it's in the URL (when we add the visual editor).

	return (
		<PolicyContext>
			<PageLayout
				class="relative"
				heading={<PageLayoutHeading class="pr-2">Edit</PageLayoutHeading>}
			>
				<Show
					when={features.visual_editor}
					fallback={
						<h2 class="text-muted-foreground opacity-70">
							Visual editor coming soon...
						</h2>
					}
				>
					{(_) => {
						const controller = createPolicyComposerController();
						return (
							<PolicyComposer
								windowsCSPs={windowsPolicies as any}
								applePayloads={applePayloads as any}
								controller={controller}
							/>
						);
					}}
				</Show>
			</PageLayout>
		</PolicyContext>
	);
}
