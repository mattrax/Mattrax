import {
	Card,
	CardHeader,
	CardTitle,
	CardDescription,
	CardContent,
	Switch,
	Collapsible,
	CollapsibleTrigger,
	CollapsibleContent,
	Checkbox,
} from "@mattrax/ui";
import { trpc } from "~/lib";
import { useTenantSlug } from "../../t.[tenantSlug]";
import {
	BruhIconPhCheckCircleDuotone,
	BruhIconPhWarningCircleDuotone,
} from "./bruh";
import type { JSX, ParentProps } from "solid-js";
import { match } from "ts-pattern";

export default function Page() {
	return (
		<div>
			<h1 class="text-2xl font-semibold">Enrollment</h1>
			<p class="mt-2 mb-3 text-gray-700 text-sm">
				Ensure your tenant is configured correctly for device enrollment.
			</p>
			<div class="flex flex-col gap-4">
				<Section title="Windows" state={"okay" /* TODO */}>
					{/* // TODO: Enable/disable enrollment */}

					{/* // TODO: Has auth provider */}
					{/* // TODO: If EntraID is enabled, we need to ensure mobility config set up or ask them to use enroll.mattrax.app */}
					{/* // TODO: If GSuite we need the CNAME configured */}
				</Section>
				<Section title="Android" state={"warning" /* TODO */}>
					{/* // TODO: Enable/disable enrollment */}
				</Section>
				<Section title="Apple" state="disabled">
					<h1 class="text-muted-foreground opacity-70">
						Apple management is not supported yet!
					</h1>

					{/* // TODO: Integrate with Apple DEP */}
					{/* // TODO: Integrate with Apple VPP */}
				</Section>

				{/* // TODO: Configure who is allowed to enroll devices */}
			</div>
		</div>
	);
}

function Section(
	props: ParentProps<{
		state: "okay" | "warning" | "disabled";
		title: JSX.Element;
	}>,
) {
	return (
		<Collapsible>
			<CollapsibleTrigger class="w-full">
				<Card class="flex flex-col p-4">
					<div class="flex items-center">
						<span class="text-2xl pr-2">
							{match(props.state)
								.with("okay", () => (
									<BruhIconPhCheckCircleDuotone class="text-green-500" />
								))
								.with("warning", () => (
									<BruhIconPhWarningCircleDuotone class="text-red-500" />
								))
								.with("disabled", () => <BruhIconPhWarningCircleDuotone />)
								.exhaustive()}
						</span>

						<CardTitle>{props.title}</CardTitle>
					</div>

					<CollapsibleContent>
						<CardContent>{props.children}</CardContent>
					</CollapsibleContent>
				</Card>
			</CollapsibleTrigger>
		</Collapsible>
	);
}

// function ConfigureEnrollmentCard() {
// 	const tenantSlug = useTenantSlug();

// 	const info = trpc.tenant.enrollmentInfo.createQuery(() => ({
// 		tenantSlug: tenantSlug(),
// 	}));
// 	// TODO: Show correct state on the UI while the mutation is pending but keep fields disabled.
// 	const setEnrollmentInfo = trpc.tenant.setEnrollmentInfo.createMutation(() => ({
// 		onSuccess: () => info.refetch(),
// 	}));

// 	return (
// 		<Card>
// 			<CardHeader>
// 				<CardTitle>Enrollment</CardTitle>
// 				<CardDescription>Configure how devices can enrollment</CardDescription>
// 			</CardHeader>
// 			<CardContent class="flex flex-col space-y-2">
// 				<div class="flex justify-between">
// 					<p>Enable enrollment</p>
// 					<Switch
// 						checked={info.latest?.enrollmentEnabled ?? true}
// 						disabled={info.latest === undefined}
// 						onChange={(state) =>
// 							setEnrollmentInfo.mutate({
// 								enrollmentEnabled: state,
// 								tenantSlug: tenantSlug(),
// 							})
// 						}
// 					/>
// 				</div>

// 				{/* // TODO: Integrate with Apple DEP */}
// 				{/* // TODO: Integrate with Apple user-initiated enrollment */}
// 				{/* // TODO: Integrate with Microsoft user-initiated enrollment */}
// 				{/* // TODO: Integrate with Android user-initiated enrollment */}
// 			</CardContent>
// 		</Card>
// 	);
// }
