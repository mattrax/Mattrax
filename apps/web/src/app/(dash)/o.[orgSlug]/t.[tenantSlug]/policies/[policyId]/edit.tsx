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

// function WipVisualEditor() {
//   const policy = usePolicy();
//   const update = trpc.policy.update.createMutation(() => ({
//     onSuccess: () => policy.query.refetch(),
//   }));

//   return (
//     <div class="space-y-2">
//       <h3 class="font-semibold pt-4">Visual Editor</h3>

//       <div class="flex pl-2">
//         {/* TODO: Properly link label to checkbox */}
//         <Label>Disable graphing calculator</Label>

//         <Checkbox
//           checked={"no_graphing_calculator_nerd" in policy().data}
//           disabled={update.isPending}
//           onChange={(checked) =>
//             update.mutate({
//               id: policy().id,
//               data: checked
//                 ? {
//                     ...policy().data,
//                     no_graphing_calculator_nerd: {
//                       type: "windows",
//                       custom: [
//                         {
//                           value: 0,
//                           oma_uri:
//                             "./User/Vendor/MSFT/Policy/Config/Education/AllowGraphingCalculator",
//                         },
//                       ],
//                     },
//                   }
//                 : {
//                     ...policy().data,
//                     no_graphing_calculator_nerd: undefined,
//                   },
//             })
//           }
//         />

//         <span class="isolate inline-flex rounded-md shadow-sm">
//           <button
//             type="button"
//             class="relative inline-flex items-center rounded-l-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-10"
//           >
//             Years
//           </button>
//           <button
//             type="button"
//             class="relative -ml-px inline-flex items-center bg-white px-3 py-2 text-sm font-semibold text-gray-900 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-10"
//           >
//             Months
//           </button>
//           <button
//             type="button"
//             class="relative -ml-px inline-flex items-center rounded-r-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-10"
//           >
//             Days
//           </button>
//         </span>

//         <Button class="rounded-r-none bg-primary/70 hover:bg-primary/80">
//           A
//         </Button>
//         <Button class="rounded-none">Inherit</Button>
//         <Button class="rounded-l-none">Inherit</Button>

//         <ToggleGroup
//           options={[
//             { label: "Allow", value: "allow" },
//             { label: "Inherit", value: "block" },
//             { label: "Block", value: "block" },
//           ]}
//         />

//         {/* // TODO: This API is nice but how do we style based on state? */}
//         {/* <ToggleGroup>
// 					<Button>Allow</Button>
// 				</ToggleGroup> */}
//       </div>
//     </div>
//   );
// }

// TODO: move into `@mattrax/ui`
// TODO: JSX options API plz
// function ToggleGroup(
//   props: ParentProps<{
//     // TODO: Remove this?
//     options?: { label: string; value: string }[];
//     // TODO: `onChange`, `value`
//   }>,
// ) {
//   // return <>{/* <For each={[]}></For> */}</>;

//   return <div class="">{props.children}</div>;
// }
