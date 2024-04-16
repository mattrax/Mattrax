import {
	Checkbox,
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
	Label,
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@mattrax/ui";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import { usePolicy } from "./Context";
import { createSignal } from "solid-js";
import { createContentEditableController } from "@mattrax/ui/lib";
import { BruhIconPhArrowsVerticalBold } from "./bruh";
import { useFeatures } from "~/lib/featureFlags";
import { trpc } from "~/lib";

export default function Page() {
	const policy = usePolicy();
	const [policyName, setPolicyName] = createSignal("./policy.yaml");
	const policyNameController = createContentEditableController(setPolicyName);
	const features = useFeatures();

	// TODO: Probs replace tabs with proper routes so it's in the URL (when we add the visual editor).

	return (
		<Tabs defaultValue="cli">
			<PageLayout
				heading={
					<div class="flex space-x-4">
						<PageLayoutHeading class="pr-2">Edit</PageLayoutHeading>

						<TabsList class="grid w-full grid-cols-2">
							<TabsTrigger value="cli">CLI</TabsTrigger>
							<TabsTrigger value="visual">Visual</TabsTrigger>
						</TabsList>
					</div>
				}
			>
				<TabsContent value="cli">
					<h3 class="font-semibold pt-4">Get started editing this policy:</h3>
					<h4 class="pl-2 font-mono">
						mttx pull {policy().id}{" "}
						<span {...policyNameController()}>{policyName()}</span>
					</h4>

					<h3 class="font-semibold pt-4">Deploy your policy:</h3>
					<h4 class="pl-2 font-mono">
						mttx deploy <span {...policyNameController()}>{policyName()}</span>
					</h4>

					<p class="pt-4">
						<a
							href="http://docs.mattrax.app/components/mttx"
							class="text-[#0000EE]"
							target="_blank"
							rel="noreferrer"
						>
							Learn more about <span class="font-mono">mttx</span> CLI
						</a>
					</p>

					<Collapsible>
						<CollapsibleTrigger class="pt-4 flex items-center">
							<BruhIconPhArrowsVerticalBold />
							Policy content
						</CollapsibleTrigger>
						<CollapsibleContent>
							<pre>{JSON.stringify(policy().data, null, 2)}</pre>
						</CollapsibleContent>
					</Collapsible>
				</TabsContent>
				<TabsContent value="visual">
					{features.visual_editor ? (
						<WipVisualEditor />
					) : (
						<h2 class="text-muted-foreground opacity-70">
							Visual editor coming soon...
						</h2>
					)}
				</TabsContent>
			</PageLayout>
		</Tabs>
	);
}

function WipVisualEditor() {
	const policy = usePolicy();
	const update = trpc.policy.update.createMutation(() => ({
		onSuccess: () => policy.query.refetch(),
	}));

	return (
		<div class="space-y-2">
			<h3 class="font-semibold pt-4">Visual Editor</h3>

			<div class="flex pl-2">
				{/* TODO: Properly link label to checkbox */}
				<Label>Disable graphing calculator nerd</Label>
				<Checkbox
					checked={"no_graphing_calculator_nerd" in policy().data}
					disabled={update.isPending}
					onChange={(checked) =>
						update.mutate({
							policyId: policy().id,
							data: checked
								? {
										...policy().data,
										no_graphing_calculator_nerd: {
											type: "windows",
											custom: [
												{
													value: 0,
													oma_uri:
														"./User/Vendor/MSFT/Policy/Config/Education/AllowGraphingCalculator",
												},
											],
										},
								  }
								: {
										...policy().data,
										no_graphing_calculator_nerd: undefined,
								  },
						})
					}
				/>
			</div>
		</div>
	);
}
