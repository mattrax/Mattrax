import { AsyncButton, Button, TabsList, TabsTrigger } from "@mattrax/ui";
import { useController } from "./Context";

export function Menubar() {
	const ctx = useController();

	return (
		<div class="flex py-1 px-2 gap-1">
			<TabsList>
				<TabsTrigger value="windows">Windows</TabsTrigger>
				<TabsTrigger value="apple">Apple</TabsTrigger>
				<TabsTrigger value="android" disabled>
					Android
				</TabsTrigger>
			</TabsList>

			<Button
				class="data-[enabled]:bg-accent group"
				variant="ghost"
				size="icon"
				data-enabled={ctx.state.filter || undefined}
				onClick={() => ctx.setState({ filter: !ctx.state.filter })}
			>
				<IconMaterialSymbolsFilterListRounded class="w-6 h-6 opacity-50 group-data-[enabled]:opacity-100" />
			</Button>

			<div class="flex space-x-2 ml-auto">
				<AsyncButton onClick={() => ctx.onSave?.()}>Save</AsyncButton>
			</div>
		</div>
	);
}
