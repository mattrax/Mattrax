import {
	PolicyComposer,
	type PolicyComposerState,
	type PolicyPlatform,
} from "@mattrax/policy-composer";

import {
	type RouteDefinition,
	createAsync,
	useSearchParams,
} from "@solidjs/router";
import { createEffect, createSignal } from "solid-js";
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
			prevStatus === "pending" &&
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
						acc[csp] = { data: data as any, enabled: true, open: true };
						return acc;
					},
					{} as NonNullable<PolicyComposerState["apple"]>,
				),
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
							{} as any,
						),
						macos: Object.entries(controller.state.apple ?? {}).reduce(
							(acc, [csp, { data, enabled }]) => {
								if (enabled) acc[csp] = data;
								return acc;
							},
							{} as Record<string, Array<Record<string, any>>>,
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
