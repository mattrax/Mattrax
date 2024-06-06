import type { PolicyData } from "@mattrax/policy";
import {
	PolicyComposer,
	type PolicyComposerState,
	type PolicyPlatform,
} from "@mattrax/policy-composer";
import {
	type RouteDefinition,
	createAsync,
	useBeforeLeave,
	useSearchParams,
} from "@solidjs/router";
import { createEffect } from "solid-js";
import { createStore } from "solid-js/store";

import { trpc } from "~/lib";
import { usePolicyId } from "../ctx";

const windowsPoliciesPromise = import(
	"@mattrax/configuration-schemas/windows/ddf.json?raw"
).then(({ default: str }) => JSON.parse(str));

const applePayloadsPromise = import(
	"@mattrax/configuration-schemas/apple/payloads.json?raw"
).then(({ default: str }) => JSON.parse(str));

export const router = {
	load: ({ params }) => {
		trpc.useContext().policy.get.ensureData({
			policyId: params.policyId!,
		});
	},
} satisfies RouteDefinition;

export default function Page() {
	const windowsPolicies = createAsync(() => windowsPoliciesPromise);
	const applePayloads = createAsync(() => applePayloadsPromise);

	const policyId = usePolicyId();

	const policy = trpc.policy.get.createQuery(() => ({
		policyId: policyId(),
	}));

	const updatePolicy = trpc.policy.update.createMutation();

	const [searchParams, setSearchParams] = useSearchParams<{
		platform: PolicyPlatform;
	}>();

	const [state, setState] = createStore<PolicyComposerState>({
		platform: searchParams.platform ?? "windows",
	});

	const controller = { state, setState };

	createEffect((prevStatus) => {
		if (
			prevStatus !== "success" &&
			policy.status === "success" &&
			policy.data
		) {
			setState({
				windows: Object.entries(policy.data.data.windows ?? {}).reduce(
					(acc, [csp, data]) => {
						acc[csp] = { data, enabled: true, open: true };
						return acc;
					},
					{} as NonNullable<PolicyComposerState["windows"]>,
				),
				apple: Object.entries(policy.data.data.macos ?? {}).reduce(
					(acc, [csp, data]) => {
						acc[csp] = { data, enabled: true, open: true };
						return acc;
					},
					{} as NonNullable<PolicyComposerState["apple"]>,
				),
			});
			useBeforeLeave((e) => {
				// Search param changes count as leaving so we ignore them here
				const toUrl = new URL(`${location.origin}${e.to}`);
				if (e.from.pathname === toUrl.pathname) return;

				if (!e.defaultPrevented) {
					e.preventDefault();

					if (window.confirm("Discard unsaved changes - are you sure?")) {
						e.retry(true);
					}
				}
			});
		}

		return policy.status;
	});

	createEffect(() => {
		setSearchParams({ platform: controller.state.platform });
	});

	return (
		<PolicyComposer
			windowsCSPs={windowsPolicies()}
			applePayloads={applePayloads()}
			controller={controller}
			onSave={async () => {
				await updatePolicy.mutateAsync({
					id: policyId(),
					data: {
						windows: Object.entries(controller.state.windows ?? {}).reduce(
							(acc, [csp, { data, enabled }]) => {
								if (enabled) acc[csp] = data;
								return acc;
							},
							{} as PolicyData["windows"],
						),
						macos: Object.entries(controller.state.apple ?? {}).reduce(
							(acc, [csp, { data, enabled }]) => {
								if (enabled) acc[csp] = data;
								return acc;
							},
							{} as PolicyData["macos"],
						),
						linux: null,
						android: null,
						scripts: [],
					},
				});
			}}
		/>
	);
}
