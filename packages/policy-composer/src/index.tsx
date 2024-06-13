import type { AppleProfilePayload } from "@mattrax/configuration-schemas/apple";
import type { WindowsCSP } from "@mattrax/configuration-schemas/windows";
import {
	AsyncButton,
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@mattrax/ui";

import { Apple } from "./Apple";
import {
	ControllerProvider,
	useController,
	type PolicyComposerController,
	type PolicyPlatform,
} from "./Context";
import { Windows } from "./Windows";
import { children, createEffect, createSignal } from "solid-js";
import { Portal } from "solid-js/web";

export * from "./Context";

export function PolicyComposer(props: {
	controller: PolicyComposerController;
	windowsCSPs?: Record<string, WindowsCSP>;
	applePayloads?: Record<string, AppleProfilePayload>;
}) {
	createEffect(() => console.log(props.controller.state.platform)); // TODO

	return (
		<ControllerProvider controller={props.controller}>
			<Tabs
				class="w-full flex flex-row items-stretch flex-1 divide-x divide-gray-200"
				value={props.controller.state.platform}
				onChange={(value) =>
					props.controller.setState("platform", value as PolicyPlatform)
				}
			>
				<TabsList>
					<TabsTrigger value="windows">Windows</TabsTrigger>
					<TabsTrigger value="apple">Apple</TabsTrigger>
					<TabsTrigger value="android" disabled>
						Android
					</TabsTrigger>
				</TabsList>

				<TabsContent value="windows">Windows</TabsContent>
				<TabsContent value="apple">Apple</TabsContent>

				{/* <div class="flex-1 max-w-xl flex sticky top-12 flex-col max-h-[calc(100vh-3rem)] overflow-hidden">
					<div class="flex justify-between py-1 px-2">
						<TabsList>
							<TabsTrigger value="windows">Windows</TabsTrigger>
							<TabsTrigger value="apple">Apple</TabsTrigger>
							<TabsTrigger value="android" disabled>
								Android
							</TabsTrigger>
						</TabsList>

						<div class="flex space-x-2">
							<AsyncButton onClick={() => props.controller.onSave?.()}>
								Save
							</AsyncButton>
						</div>
					</div>
				</div> */}

				{/* <TabsContent
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
				</TabsContent> */}
			</Tabs>
		</ControllerProvider>
	);
}
