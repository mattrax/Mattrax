import { createContextProvider } from "@solid-primitives/context";
import { Navigate } from "@solidjs/router";
import {
	Match,
	type ParentProps,
	Suspense,
	Switch,
	createSignal,
	onMount,
} from "solid-js";
import { db, subscribeToInvalidations } from "../util/db";

export const [Provider, useAccessToken] = createContextProvider(
	(props: { accessToken: string }) => props.accessToken,
	undefined!,
);

export function useAccessTokenRaw() {
	const [accessToken, setAccessToken] = createSignal<string | null | undefined>(
		undefined,
	);
	const setAccessTokenCb = () =>
		db.then(async (db) =>
			setAccessToken((await db.get("_meta", "accessToken")) ?? null),
		);
	onMount(setAccessTokenCb);
	subscribeToInvalidations((store) => {
		if (store === "auth") setAccessTokenCb();
	});

	return accessToken;
}

export default function Layout(props: ParentProps) {
	const accessToken = useAccessTokenRaw();

	return (
		<div class="p-4">
			<Suspense>
				<Switch>
					<Match when={accessToken()} keyed>
						{(accessToken) => (
							<Provider accessToken={accessToken}>{props.children}</Provider>
						)}
					</Match>
					<Match when={accessToken() === null}>
						<Navigate href="/" />
					</Match>
				</Switch>
			</Suspense>
		</div>
	);
}
