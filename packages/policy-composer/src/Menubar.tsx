import { AsyncButton, TabsList, TabsTrigger } from "@mattrax/ui";
import { useController } from "./Context";

export function Menubar() {
	const ctx = useController();

	return (
		<div class="flex justify-between py-1 px-2">
			<TabsList>
				<TabsTrigger value="windows">Windows</TabsTrigger>
				<TabsTrigger value="apple">Apple</TabsTrigger>
				<TabsTrigger value="android" disabled>
					Android
				</TabsTrigger>
			</TabsList>

			<div class="flex space-x-2">
				<AsyncButton onClick={() => ctx.onSave?.()}>Save</AsyncButton>
			</div>
		</div>
	);
}
