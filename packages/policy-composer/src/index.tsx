import type { AppleProfilePayload } from "@mattrax/configuration-schemas/apple";
import type { WindowsCSP } from "@mattrax/configuration-schemas/windows";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@mattrax/ui";

import { Apple } from "./Apple";
import { ControllerProvider, type VisualEditorController } from "./Context";
import { Windows } from "./Windows";

export { createPolicyComposerController } from "./Context";

export function PolicyComposer(props: {
	controller: VisualEditorController;
	windowsCSPs?: Record<string, WindowsCSP>;
	applePayloads?: Record<string, AppleProfilePayload>;
}) {
	return (
		<ControllerProvider controller={props.controller}>
			<Tabs class="w-full flex flex-row items-start divide-x divide-gray-200">
				<nav class="flex flex-col p-3 sticky top-12">
					<TabsList>
						<TabsTrigger value="windows">Windows</TabsTrigger>
						<TabsTrigger value="apple">Apple</TabsTrigger>
					</TabsList>
				</nav>
				<TabsContent
					value="windows"
					class="w-full h-full flex flex-row divide-x divide-gray-200"
				>
					<Windows csps={props.windowsCSPs} />
				</TabsContent>
				<TabsContent
					value="apple"
					class="w-full h-full flex flex-row divide-x divide-gray-200"
				>
					<Apple payloads={props.applePayloads} />
				</TabsContent>
			</Tabs>
		</ControllerProvider>
	);
}
