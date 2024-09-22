import { PolicyComposer } from "@mattrax/policy-composer";
import { BreadcrumbItem, BreadcrumbLink } from "@mattrax/ui";
import { createAsync } from "@solidjs/router";
import { Suspense } from "solid-js";
import { createStore } from "solid-js/store";
import { Page } from "~/components/Page";

const windowsPoliciesPromise = import(
	"@mattrax/configuration-schemas/windows/ddf.json?raw"
).then(({ default: str }) => JSON.parse(str));

const applePayloadsPromise = import(
	"@mattrax/configuration-schemas/apple/payloads.json?raw"
).then(({ default: str }) => JSON.parse(str));

export default function () {
	const [state, setState] = createStore({
		// TODO: Make this a URL component
		platform: "windows",
		windows: {
			// "./Device/Vendor/MSFT/BitLocker": {
			// 	enabled: true,
			// 	data: {},
			// 	open: false,
			// },
		},
	});
	const windowsPolicies = createAsync(() => windowsPoliciesPromise);
	const applePayloads = createAsync(() => applePayloadsPromise);

	// TODO: Implement properly: https://github.com/mattrax/Mattrax/blob/d2aaafa5f14f9f215b0c6c2f15791291ef898527/apps/web/src/app/(dash)/o.%5BorgSlug%5D/t.%5BtenantSlug%5D/policies/%5BpolicyId%5D/edit.tsx#L1

	return (
		<Page
			breadcrumbs={[
				<BreadcrumbItem>
					<BreadcrumbLink href="#todo">Policy A</BreadcrumbLink>
				</BreadcrumbItem>,
				<BreadcrumbItem bold>Composer</BreadcrumbItem>,
			]}
		>
			<div class="w-screen h-screen">
				<Suspense fallback={<div>Loading...</div>}>
					<PolicyComposer
						controller={{
							// @ts-expect-error
							state,
							// @ts-expect-error
							setState: setState,
						}}
						windowsCSPs={windowsPolicies()}
						applePayloads={applePayloads()}
					/>
				</Suspense>
			</div>
		</Page>
	);
}
