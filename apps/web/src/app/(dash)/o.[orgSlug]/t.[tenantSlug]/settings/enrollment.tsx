import {
	Badge,
	DescriptionDetails,
	DescriptionList,
	DescriptionTerm,
} from "@mattrax/ui";
import { Match, Show, Suspense, Switch, type ParentProps } from "solid-js";
import {
	BruhIconPhCheckCircleDuotone,
	BruhIconPhWarningCircleDuotone,
} from "./bruh";
import { trpc } from "~/lib";
import { useTenantSlug } from "../../t.[tenantSlug]";
import { A, type RouteDefinition } from "@solidjs/router";
import clsx from "clsx";

export const route = {
	load: ({ params }) => {
		trpc.useContext().tenant.identityProvider.get.ensureData({
			tenantSlug: params.tenantSlug!,
		});
		trpc.useContext().tenant.enrollmentInfo.ensureData({
			tenantSlug: params.tenantSlug!,
		});
		trpc.useContext().tenant.identityProvider.domains.ensureData({
			tenantSlug: params.tenantSlug!,
		});
	},
} satisfies RouteDefinition;

export default function Page() {
	const tenantSlug = useTenantSlug();
	const provider = trpc.tenant.identityProvider.get.createQuery(() => ({
		tenantSlug: tenantSlug(),
	}));
	const enrollmentInfo = trpc.tenant.enrollmentInfo.createQuery(() => ({
		tenantSlug: tenantSlug(),
	}));
	const domains = trpc.tenant.identityProvider.domains.createQuery(() => ({
		tenantSlug: tenantSlug(),
	}));

	return (
		<div>
			<h1 class="text-2xl font-semibold">Enrollment</h1>
			<p class="mt-2 mb-3 text-gray-700 text-sm">
				Ensure your tenant is configured correctly for device enrollment.
			</p>
			<div class="flex flex-col gap-4">
				<DescriptionList>
					<DescriptionTerm>Enabled</DescriptionTerm>
					<Details>
						<BruhIconPhCheckCircleDuotone class="text-green-500 text-2xl" />
					</Details>

					<DescriptionTerm>Identity provider</DescriptionTerm>
					<Details>
						<Show
							when={provider.data === null}
							fallback={
								<BruhIconPhCheckCircleDuotone class="text-green-500 text-2xl" />
							}
						>
							<BruhIconPhWarningCircleDuotone class="text-red-500 text-2xl" />
							<p>
								<A
									href="../identity-provider"
									class="font-medium text-blue-600 dark:text-blue-500 hover:underline pr-1"
								>
									Setup
								</A>
								an identity provider
							</p>
						</Show>
					</Details>

					<h2 class="text-black py-2 text-xl font-medium">Windows</h2>

					<DescriptionTerm>Capabilities</DescriptionTerm>
					<Details>
						<Switch fallback={<Badge variant="success">DEVICE</Badge>}>
							<Match when={provider.data === null}>
								<Badge variant="destructive">UNSUPPORTED</Badge>
								<p>You must have an identity provider</p>
							</Match>

							<Match when={provider.data?.provider !== "entraId"}>
								<Badge
									variant="ghost"
									class="bg-orange-200 text-orange-800 hover:bg-orange-200/80 border-transparent"
								>
									USER
								</Badge>
								<p>EntraID is required for accessing all device features</p>
							</Match>

							<Match
								when={
									provider.data?.provider === "entraId" &&
									enrollmentInfo.data?.winMobilityConfig !== "VALID"
								}
							>
								<Badge
									variant="ghost"
									class="bg-orange-200 text-orange-800 hover:bg-orange-200/80 border-transparent"
								>
									USER
								</Badge>
								<p>
									EntraID must be configured for mobility to access all device
									features
								</p>
							</Match>
						</Switch>
					</Details>

					<DescriptionTerm>Discovery domain</DescriptionTerm>
					<Details>
						<Show
							when={provider.data && provider.data?.provider !== "entraId"}
							fallback={<Badge>NOT REQUIRED</Badge>}
						>
							{(() => {
								const enterpriseEnrollmentAvailableCount =
									domains.data?.connectedDomains?.reduce(
										(count, item) =>
											// @ts-expect-error: boolean will be casted to number by runtime
											count + (item.enterpriseEnrollmentAvailable === true),
										0,
									);

								if (
									enterpriseEnrollmentAvailableCount ===
									domains.data?.connectedDomains?.length
								) {
									return <Badge>CONFIGURED</Badge>;
								}

								if (enterpriseEnrollmentAvailableCount === 0) {
									return (
										<>
											<Badge variant="destructive">Required</Badge>
											<p>
												At least one{" "}
												<A
													href="../identity-provider"
													class="font-medium text-blue-600 dark:text-blue-500 hover:underline pr-1"
												>
													domain
												</A>
												must be configured for enrollment
											</p>
										</>
									);
								}

								return (
									<>
										<Badge
											variant="ghost"
											class="bg-orange-200 text-orange-800 hover:bg-orange-200/80 border-transparent"
										>
											Partially configured
										</Badge>
										<p>
											All{" "}
											<A
												href="../identity-provider"
												class="font-medium text-blue-600 dark:text-blue-500 hover:underline pr-1"
											>
												domains
											</A>
											should be configured for enrollment
										</p>
									</>
								);
							})()}
						</Show>
					</Details>

					<DescriptionTerm>EntraID Mobility Configuration</DescriptionTerm>
					<Details>
						<Show
							when={provider.data?.provider === "entraId"}
							fallback={<Badge>NOT REQUIRED</Badge>}
						>
							<Switch>
								<Match
									when={enrollmentInfo.data?.winMobilityConfig === "VALID"}
								>
									<Badge variant="success">VALID</Badge>
								</Match>
								<Match
									when={
										enrollmentInfo.data?.winMobilityConfig ===
										"MISSING_PROVIDER"
									}
								>
									<Badge
										variant="ghost"
										class="bg-orange-200 text-orange-800 hover:bg-orange-200/80 border-transparent"
									>
										NOT SUPPORTED
									</Badge>
									<p>Mattrax is not configured for mobility in EntraID</p>
								</Match>
								<Match
									when={
										enrollmentInfo.data?.winMobilityConfig === "INVALID_SCOPE"
									}
								>
									<Badge
										variant="ghost"
										class="bg-orange-200 text-orange-800 hover:bg-orange-200/80 border-transparent"
									>
										NOT SUPPORTED
									</Badge>
									<p>
										{/* TODO: Reference to the Mattrax docs for this */}
										The scope defined in EntraID doesn't match any devices
									</p>
								</Match>
								<Match
									when={
										enrollmentInfo.data?.winMobilityConfig ===
										"INVALID_SUBSCRIPTION"
									}
								>
									<Badge
										variant="ghost"
										class="bg-orange-200 text-orange-800 hover:bg-orange-200/80 border-transparent"
									>
										NOT SUPPORTED
									</Badge>
									<p>
										{/* TODO: Reference to the Mattrax docs for this */}
										We detected your EntraID subscription doesn't support
										Mobility
									</p>
								</Match>
							</Switch>
						</Show>
					</Details>

					<h2 class="text-black py-2 text-xl font-medium">Apple</h2>

					<DescriptionTerm>Enabled</DescriptionTerm>
					<Details>
						<BruhIconPhWarningCircleDuotone class="text-2xl" />
						<p>Apple management is not supported yet!</p>
					</Details>
					<DescriptionTerm>Device Enrollment Program</DescriptionTerm>
					<Details>
						<BruhIconPhWarningCircleDuotone class="text-2xl" />
					</Details>
					<DescriptionTerm>Apple Business Manager</DescriptionTerm>
					<Details>
						<BruhIconPhWarningCircleDuotone class="text-2xl" />
					</Details>
					<DescriptionTerm>Volume Purchase Program</DescriptionTerm>
					<Details>
						<BruhIconPhWarningCircleDuotone class="text-2xl" />
					</Details>

					<h2 class="text-black py-2 text-xl font-medium">Android</h2>
					<DescriptionTerm>Enabled</DescriptionTerm>
					<Details>
						<BruhIconPhWarningCircleDuotone class="text-2xl" />
						<p>Android management is not supported yet!</p>
					</Details>
				</DescriptionList>
			</div>
		</div>
	);
}

const Details = (props: ParentProps) => {
	return (
		<Suspense
			fallback={
				<div class="flex items-center">
					<div class="w-7 h-1/2 bg-neutral-200 animate-pulse rounded-full" />
				</div>
			}
		>
			<DescriptionDetails class="flex items-center space-x-2">
				{props.children}
			</DescriptionDetails>
		</Suspense>
	);
};
