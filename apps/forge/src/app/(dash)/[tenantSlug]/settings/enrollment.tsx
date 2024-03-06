export default function Page() {
	return (
		<div>
			<h1 class="text-2xl font-semibold">Enrollment</h1>
			<p class="mt-2 mb-3 text-gray-700 text-sm">
				Ensure your tenant is ready for device enrollment.
			</p>
			<div class="flex flex-col gap-4">
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
