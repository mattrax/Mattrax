import type { AppleProfilePayload } from "@mattrax/configuration-schemas/apple";
import type { WindowsCSP } from "@mattrax/configuration-schemas/windows";
import {
	AsyncButton,
	Button,
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@mattrax/ui";

import { Apple } from "./Apple";
import {
	ControllerProvider,
	type PolicyComposerController,
	type PolicyPlatform,
} from "./Context";
import { Windows } from "./Windows";

export * from "./Context";

export function PolicyComposer(props: {
	controller: PolicyComposerController;
	windowsCSPs?: Record<string, WindowsCSP>;
	applePayloads?: Record<string, AppleProfilePayload>;
	onSave?: () => Promise<any>;
}) {
	return (
		<ControllerProvider controller={props.controller}>
			<Tabs
				class="w-full flex flex-row items-stretch flex-1 divide-x divide-gray-200"
				value={props.controller.state.platform}
				onChange={(value) =>
					props.controller.setState("platform", value as PolicyPlatform)
				}
			>
				<div class="flex flex-col p-3 sticky top-12 max-h-[calc(100vh-3rem)] gap-2">
					<TabsList>
						<TabsTrigger value="windows">Windows</TabsTrigger>
						<TabsTrigger value="apple">Apple</TabsTrigger>
					</TabsList>
					<AsyncButton onClick={() => props.onSave?.()}>Save</AsyncButton>
				</div>
				<TabsContent
					value="windows"
					class="flex-1 flex flex-row divide-x divide-gray-200"
				>
					<Windows csps={props.windowsCSPs} />
				</TabsContent>
				<TabsContent
					value="apple"
					class="flex-1 flex flex-row divide-x divide-gray-200"
				>
					<Apple payloads={props.applePayloads} />
				</TabsContent>
			</Tabs>
		</ControllerProvider>
	);
}
