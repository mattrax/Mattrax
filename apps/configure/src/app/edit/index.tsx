import { match } from "ts-pattern";

import { Button, Input, Label } from "@mattrax/ui";
import { useFile, type File } from "~/file";

export default function Component() {
	const fileCtx = useFile();

	return (
		<div class="flex flex-col space-y-4">
			<Label>Name</Label>
			<Input
				name="name"
				value={fileCtx.file.meta.name}
				onInput={(e) => fileCtx.setFile("meta", "name", e.target.value)}
			/>

			<pre>{renderSyncML(fileCtx.file)}</pre>

			{/* TODO: Supported platforms & scope */}

			{/* TODO: Autosave */}

			{/* <Button
				type="button"
				disabled
				onClick={() => {
					fileCtx.save(
						xml({ a: [{ _attr: { attributes: "are fun", too: "!" } }, 1] }),
					);
				}}
			>
				Export Windows
			</Button>
			<Button
				type="button"
				disabled
				onClick={() => {
					fileCtx.save(
						plist.build([
							"metadata",
							{
								"bundle-identifier": "com.company.app",
								"bundle-version": "0.1.1",
								kind: "software",
								title: "AppName",
							},
						]),
					);
				}}
			>
				Export Apple
			</Button> */}
		</div>
	);
}

function renderSyncML(file: File) {
	const result: string[] = [];
	for (const restriction of file.restrictions) {
		match(restriction)
			.with({ type: "wifi" }, (wifi) => {
				result.push("wifi"); // TODO: generate xml
			})
			.with({ type: "todo" }, () => {
				throw new Error("TODO");
			})
			.exhaustive();
	}

	return result.join("\n");
}
