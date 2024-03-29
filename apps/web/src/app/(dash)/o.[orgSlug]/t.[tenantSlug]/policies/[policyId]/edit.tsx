import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
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

export default function Page() {
	const policy = usePolicy();
	const [policyName, setPolicyName] = createSignal("./policy.yaml");
	const policyNameController = createContentEditableController(setPolicyName);

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
					<h2 class="text-muted-foreground opacity-70">
						Visual editor coming soon...
					</h2>
				</TabsContent>
			</PageLayout>
		</Tabs>
	);
}
