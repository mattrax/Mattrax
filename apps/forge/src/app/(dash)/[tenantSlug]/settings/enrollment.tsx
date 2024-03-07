import {
	Card,
	CardHeader,
	CardTitle,
	CardDescription,
	CardContent,
	Switch,
} from "~/components/ui";
import { trpc, untrackScopeFromSuspense } from "~/lib";
import { useTenant } from "../../TenantContext";

export default function Page() {
	return (
		<div>
			<h1 class="text-2xl font-semibold">Enrollment</h1>
			<p class="mt-2 mb-3 text-gray-700 text-sm">
				Ensure your tenant is ready for device enrollment.
			</p>
			<div class="flex flex-col gap-4">
				<ConfigureEnrollmentCard />

				<h2 class="text-muted-foreground opacity-70">Coming soon...</h2>

				{/* // TODO: Enable/disable enrollment */}

				{/* // TODO: Configure who is allowed to enroll devices */}

				{/* // TODO: Has auth provider */}
				{/* // TODO: If EntraID is enabled, we need to ensure mobility config set up or ask them to use enroll.mattrax.app */}
				{/* // TODO: If GSuite we need the CNAME configured */}
			</div>
		</div>
	);
}

function ConfigureEnrollmentCard() {
	const tenant = useTenant();

	const enrollmentInfo = trpc.tenant.enrollmentInfo.useQuery(() => ({
		tenantSlug: tenant().slug,
	}));
	// TODO: Show correct state on the UI while the mutation is pending but keep fields disabled.
	const setEnrollmentInfo = trpc.tenant.setEnrollmentInfo.useMutation(() => ({
		onSuccess: () => enrollmentInfo.refetch(),
	}));
	const enrollmentEnabled = untrackScopeFromSuspense(
		() => enrollmentInfo.data?.enrollmentEnabled,
	);

	return (
		<Card>
			<CardHeader>
				<CardTitle>Enrollment</CardTitle>
				<CardDescription>Configure how devices can enrollment</CardDescription>
			</CardHeader>
			<CardContent class="flex flex-col space-y-2">
				<div class="flex justify-between">
					<p>Enable enrollment</p>
					<Switch
						checked={enrollmentEnabled() ?? true}
						disabled={enrollmentEnabled() === undefined}
						onChange={(state) =>
							setEnrollmentInfo.mutate({
								enrollmentEnabled: state,
								tenantSlug: tenant().slug,
							})
						}
					/>
				</div>

				{/* // TODO: Integrate with Apple DEP */}
				{/* // TODO: Integrate with Apple user-initiated enrollment */}
				{/* // TODO: Integrate with Microsoft user-initiated enrollment */}
				{/* // TODO: Integrate with Android user-initiated enrollment */}
			</CardContent>
		</Card>
	);
}
