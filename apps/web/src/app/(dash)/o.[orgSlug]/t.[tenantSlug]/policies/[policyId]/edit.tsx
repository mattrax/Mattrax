import {
	Button,
	Checkbox,
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
	Label,
	Tabs,
	TabsContent,
	TabsIndicator,
	TabsList,
	TabsTrigger,
} from "@mattrax/ui";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import { PolicyContext, usePolicy } from "./Context";
import { type ParentProps, createSignal, Show } from "solid-js";
import { createContentEditableController } from "@mattrax/ui/lib";
import { BruhIconPhArrowsVerticalBold } from "./bruh";
import { useFeatures } from "~/lib/featureFlags";
import { trpc } from "~/lib";
import { VisualEditor, createVisualEditor } from "./VisualEditor";

export default function Page() {
	const policy = () => usePolicy()();
	const [policyName, setPolicyName] = createSignal("./policy.yaml");
	const policyNameController = createContentEditableController(setPolicyName);
	const features = useFeatures();

	// TODO: Probs replace tabs with proper routes so it's in the URL (when we add the visual editor).

	return (
		<PolicyContext>
			<Tabs defaultValue="visual">
				<PageLayout
					heading={
						<div class="flex space-x-4">
							<PageLayoutHeading class="pr-2">Edit</PageLayoutHeading>

							<TabsList class="grid w-full grid-cols-2">
								<TabsTrigger value="cli">CLI</TabsTrigger>
								<TabsTrigger value="visual">Visual</TabsTrigger>
								<TabsIndicator />
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
							mttx deploy{" "}
							<span {...policyNameController()}>{policyName()}</span>
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
						<Show
							when={features.visual_editor}
							fallback={
								<h2 class="text-muted-foreground opacity-70">
									Visual editor coming soon...
								</h2>
							}
						>
							{(_) => {
								const controller = createVisualEditor();
								return <VisualEditor controller={controller} />;
							}}
						</Show>
					</TabsContent>
				</PageLayout>
			</Tabs>
		</PolicyContext>
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
				<Label>Disable graphing calculator</Label>

				<Checkbox
					checked={"no_graphing_calculator_nerd" in policy().data}
					disabled={update.isPending}
					onChange={(checked) =>
						update.mutate({
							id: policy().id,
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

				<span class="isolate inline-flex rounded-md shadow-sm">
					<button
						type="button"
						class="relative inline-flex items-center rounded-l-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-10"
					>
						Years
					</button>
					<button
						type="button"
						class="relative -ml-px inline-flex items-center bg-white px-3 py-2 text-sm font-semibold text-gray-900 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-10"
					>
						Months
					</button>
					<button
						type="button"
						class="relative -ml-px inline-flex items-center rounded-r-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-10"
					>
						Days
					</button>
				</span>

				<Button class="rounded-r-none bg-primary/70 hover:bg-primary/80">
					A
				</Button>
				<Button class="rounded-none">Inherit</Button>
				<Button class="rounded-l-none">Inherit</Button>

				<ToggleGroup
					options={[
						{ label: "Allow", value: "allow" },
						{ label: "Inherit", value: "block" },
						{ label: "Block", value: "block" },
					]}
				/>

				{/* // TODO: This API is nice but how do we style based on state? */}
				{/* <ToggleGroup>
					<Button>Allow</Button>
				</ToggleGroup> */}
			</div>
		</div>
	);
}

// TODO: move into `@mattrax/ui`
// TODO: JSX options API plz
function ToggleGroup(
	props: ParentProps<{
		// TODO: Remove this?
		options?: { label: string; value: string }[];
		// TODO: `onChange`, `value`
	}>,
) {
	// return <>{/* <For each={[]}></For> */}</>;

	return <div class="">{props.children}</div>;
}
