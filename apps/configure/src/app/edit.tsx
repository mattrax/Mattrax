import { readTextFile, writeFile } from "@tauri-apps/api/fs";
import {
	type ParentProps,
	Show,
	createResource,
	createEffect,
	Suspense,
} from "solid-js";
import { createStore } from "solid-js/store";
import { trackDeep } from "@solid-primitives/deep";
import { FileProvider, path, type File, setRecents } from "~/file";
import { Navigate } from "@solidjs/router";

export default function Layout(props: ParentProps) {
	return (
		<Show when={path()} fallback={<Navigate href="/" />}>
			{(path) => {
				const [file] = createResource(async () =>
					createStore<File>(JSON.parse(await readTextFile(path()))),
				);

				const save = () => {
					const f = file();
					if (!f) return;

					const p = path();
					if (!p) return;

					writeFile(p, JSON.stringify(f[0], null, 4));
				};

				createEffect(() => {
					trackDeep(file);
					save();
				});

				// Updates name on recents & ensures most recent's are first
				createEffect(() => {
					const name = file()?.[0].meta.name;
					if (!name) return;
					setRecents((recents) => [
						{
							name,
							path: path(),
						},
						...recents.filter((recent) => recent.path !== path()),
					]);
				});

				return (
					<Show when={file()} keyed fallback={<p>Loading file...</p>}>
						{([file, setFile]) => (
							<FileProvider file={file} setFile={setFile}>
								<main class="p-4 flex flex-col w-full overflow-y-scroll">
									<Suspense>{props.children}</Suspense>
								</main>
							</FileProvider>
						)}
					</Show>
				);
			}}
		</Show>
	);
}
