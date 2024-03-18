import { createSignal } from "solid-js";
import { createContextProvider } from "@solid-primitives/context";
import type { SetStoreFunction } from "solid-js/store";
import { makePersisted } from "@solid-primitives/storage";

export type File = {
	meta: {
		name: string;
	};
	restrictions: Restriction[];
};

export type WiFiRestriction = {
	type: "wifi";
} & (
	| {
			network_type: "basic";
			ssid: string;
			// connect_in_range?: boolean;
			// low_priority?: boolean; // TODO: Require `connect_in_range: true` for this to be configurable.
			// connect_when_hidden?: boolean;
			security:
				| {
						type: "open";
				  }
				| {
						type: "wpa2";
						preshared_key: string;
						// TODO: Windows has - "Force Wi-Fi profile to be compliant with the Federal Information Processing Standard (FIPS)"
				  };

			// TODO: Windows has - "Metered connection limit" & "Company proxy settings"
	  }
	| {
			network_type: "enterprise";
			// TODO: Implement this
	  }
);

type TODO = {
	type: "todo";
};

type Restriction = WiFiRestriction | TODO;

export const [FileProvider, useFile] = createContextProvider(
	(ctx: {
		file: File;
		setFile: SetStoreFunction<File>;
	}) => ctx,
	// biome-ignore lint/style/noNonNullAssertion: <explanation>
	undefined!,
);

export const [path, setPath] = createSignal<string | null>(null);

type Recent = {
	name: string;
	path: string;
};

export const [recents, setRecents] = makePersisted(
	createSignal([] as Recent[]),
	{
		name: "recents",
	},
);
