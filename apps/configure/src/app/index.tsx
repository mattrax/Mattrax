import { useNavigate } from "@solidjs/router";
import { save, open } from "@tauri-apps/api/dialog";
import { writeFile } from "@tauri-apps/api/fs";
import { For, startTransition } from "solid-js";
import { Button } from "~/components/ui";
import { recents, setPath, setRecents } from "~/file";

export default function Component() {
	const navigate = useNavigate();

	return (
		<div>
			<h1>Recents</h1>

			<div class="space-x-4">
				<Button
					onClick={async () => {
						const newPath = await save({
							defaultPath: "configuration.json",
							filters: [
								{
									name: "json",
									extensions: ["json"],
								},
							],
						});
						if (!newPath) return;
						setPath(newPath);
						writeFile(
							newPath,
							JSON.stringify(
								{
									meta: {
										name: "Untitled",
									},
									restrictions: [],
								},
								null,
								4,
							),
						);
						if (!recents().find((recent) => recent.path === newPath))
							setRecents((recents) => [
								...recents,
								{
									name: "Untitled",
									path: newPath,
								},
							]);

						startTransition(() => navigate("/edit"));
					}}
				>
					Create
				</Button>
				<Button
					onClick={async () => {
						const path = await open({
							filters: [
								{
									name: "json",
									extensions: ["json"],
								},
							],
							multiple: false,
						});

						if (typeof path !== "string") return;
						setPath(path);

						if (!recents().find((recent) => recent.path === path))
							setRecents((recents) => [
								...recents,
								{
									name: "Untitled", // TODO: Get this from the file + keep it updated
									path: path,
								},
							]);

						startTransition(() => navigate("/edit"));
					}}
				>
					Open
				</Button>
			</div>

			<div class="flex flex-col space-y-2 justify-start pt-4">
				<For each={recents()}>
					{(recent) => (
						<button
							type="button"
							onClick={() => {
								setPath(recent.path);
								startTransition(() => navigate("/edit"));
							}}
						>
							<h2>{recent.name}</h2>
						</button>
					)}
				</For>
			</div>
		</div>
	);
}
