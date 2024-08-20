import { z } from "zod";
import { mapUser } from "~/lib/auth";
import { getKey, putKey } from "../../kv";
import {
	odataResponseSchema,
	registerBatchedOperationAsync,
} from "../microsoft";
import { defineSyncOperation } from "../operation";

const userSchema = z.object({
	id: z.string(),
	displayName: z.string(),
	userPrincipalName: z.string(),
});

export const me = defineSyncOperation<undefined>(
	"me",
	async ({ db, accessToken }) => {
		const oldMe = await getKey(db, "user");

		const responses = await registerBatchedOperationAsync(
			[
				{
					id: "me",
					method: "GET",
					url: "/me?$select=id,displayName,userPrincipalName",
				},
				{
					id: "mePhoto",
					method: "GET",
					url: "/me/photo/$value",
					headers: oldMe?.avatarEtag
						? {
								"If-None-Match": oldMe?.avatarEtag,
							}
						: {},
				},
			],
			accessToken,
		);

		const [me, mePhoto] = [responses[0]!, responses[1]!];

		if (me.status !== 200)
			throw new Error(`Failed to fetch me. Got status ${me.status}`);

		const result = userSchema.safeParse(me.body);
		if (result.error)
			throw new Error(`Failed to parse me response. ${result.error.message}`);

		const user = mapUser(result.data);

		// Will be `404` if the user has no photo.
		if (mePhoto.status === 200) {
			user.avatar = `data:image/*;base64,${mePhoto.body}`;
			user.avatarEtag = mePhoto.headers?.ETag;
		} else if (mePhoto.status !== 404 && mePhoto.status !== 304) {
			// We only log cause this is not a critical error.
			console.error(`Failed to fetch me photo. Got status ${mePhoto.status}`);
		}

		await putKey(db, "user", user);

		return {
			type: "complete",
			meta: undefined,
		};
	},
);

const orgSchema = z.object({
	id: z.string(),
	displayName: z.string(),
	countryLetterCode: z.string(),
	assignedPlans: z.array(
		z.object({
			assignedDateTime: z.string().datetime(),
			capabilityStatus: z.enum([
				"Enabled",
				"Warning",
				"Suspended",
				"Deleted",
				"LockedOut",
			]),
			service: z.string(),
			servicePlanId: z.string(),
		}),
	),
});

export const domainSchema = z.object({
	id: z.string(),
	authenticationType: z.enum(["Managed", "Federated"]),
	isAdminManaged: z.boolean(),
	isDefault: z.boolean(),
	isInitial: z.boolean(),
	isRoot: z.boolean(),
	isVerified: z.boolean(),
});

export type Org = {
	id: string;
	name: string;
	countryLetterCode: string;
	plan: string;
	domains: z.infer<typeof domainSchema>[];
};

export const organization = defineSyncOperation(
	"organization",
	async ({ db, accessToken }) => {
		const responses = await registerBatchedOperationAsync(
			[
				{
					id: "organization",
					method: "GET",
					url: "/organization?$select=id,displayName,assignedPlans,countryLetterCode",
				},
				{
					id: "orgDomains",
					method: "GET",
					url: "/domains?$select=id,authenticationType,isAdminManaged,isDefault,isInitial,isRoot,isVerified",
				},
			],
			accessToken,
		);

		const org = responses[0]!;
		const domains = responses[1]!;

		if (org.status !== 200)
			throw new Error(`Failed to fetch org. Got status ${org.status}`);

		const result = odataResponseSchema(orgSchema).safeParse(org.body);
		if (result.error)
			throw new Error(
				`Failed to parse organization response. ${result.error.message}`,
			);

		if (result.data.value[0] === undefined) {
			throw new Error("No organisations was found!");
		} else if (result.data.value.length > 1) {
			console.warn("Found multiple organisations. Choosing the first one!");
		}

		const data = result.data.value[0];
		if ("@removed" in data)
			throw new Error("A non-delta query returned `@removed`!");

		let d: z.infer<typeof domainSchema>[] = [];
		if (domains.status === 200) {
			const result2 = odataResponseSchema(domainSchema).safeParse(domains.body);
			if (result2.error)
				console.error(
					`Failed to parse domains response. ${result2.error.message}`,
				);

			// @ts-expect-error // TODO: Fix this with better odata validation
			d = result2.data?.value || [];
		} else {
			console.error(`Failed to domains org. Got status ${domains.status}`);
		}

		await putKey(db, "org", {
			id: data.id,
			name: data.displayName,
			countryLetterCode: data.countryLetterCode,
			plan: determinePlan(data.assignedPlans),
			domains: d.sort((a, b) => a.id.localeCompare(b.id)),
		});

		return {
			type: "complete",
			meta: undefined,
		};
	},
);

const mobilityAppSchema = z.object({
	id: z.string(),
	appliesTo: z.enum(["none", "all", "selected"]),
	// Only present when `appliesTo` is `selected`
	includedGroups: z
		.array(
			z.object({
				id: z.string(),
				displayName: z.string(),
			}),
		)
		.optional(),
	displayName: z.string(),
	description: z.string().optional(),
	isValid: z.boolean(),

	discoveryUrl: z.string().optional(),
	complianceUrl: z.string().optional(),
	termsOfUseUrl: z.string().optional(),
});

export type MobilityApp = z.infer<typeof mobilityAppSchema>;

export const organizationMobility = defineSyncOperation<"getLogos" | undefined>(
	"organizationMobility",
	async ({ db, accessToken, metadata }) => {
		if (metadata === "getLogos") {
			// TODO: Fetch icons -> It's a pain cause we need the `servicePrincipals` and app template URL's
			// const apps = await getKey(db, "orgMobility");
			// if (apps) {
			// 	// TODO: ETag caching
			// 	const responses = await registerBatchedOperationAsync(
			// 		apps.map((app, i) => ({
			// 			id: `orgMobilityLogo-${i}`,
			// 			method: "GET",
			// 			url: `/servicePrincipals(appId='${encodeURIComponent(app.id)}')/info/logoUrl`,
			// 		})),
			// 		accessToken,
			// 	);

			// 	// /applicationTemplates/0000000a-0000-0000-c000-000000000000?$select=logoUrl

			// 	console.log(responses); // TODO
			// }

			return {
				type: "complete",
				meta: undefined,
			};
		} else {
			const responses = await registerBatchedOperationAsync(
				{
					id: "orgMobility",
					method: "GET",
					url: "/policies/mobileDeviceManagementPolicies?$select=id,appliesTo,displayName,description,isValid,discoveryUrl,complianceUrl,termsOfUseUrl&$expand=includedGroups($select=id,displayName)",
				},
				accessToken,
			);

			const apps = responses[0]!;

			if (apps.status !== 200)
				throw new Error(
					`Failed to fetch org mobility. Got status ${apps.status}`,
				);

			const result = odataResponseSchema(mobilityAppSchema).safeParse(
				apps.body,
			);
			if (result.error)
				throw new Error(
					`Failed to parse org mobility response. ${result.error.message}`,
				);

			// @ts-expect-error // TODO: Fix types
			await putKey(db, "orgMobility", result.data.value);

			return {
				type: "complete",
				meta: undefined,
			};
			// return {
			// 	type: "continue",
			// 	meta: "getLogos",
			// };
		}
	},
);

// This check was reverse engineered from Azure's source code
function determinePlan(
	assignedPlans: z.infer<typeof orgSchema>["assignedPlans"],
) {
	const plans: Record<string, boolean> = {};
	for (const plan of assignedPlans) {
		plans[plan.servicePlanId] =
			plan.capabilityStatus === "Enabled" ||
			plan.capabilityStatus === "Warning";
	}

	const planEligibility = {
		aadPremium:
			plans["078d2b04-f1bd-4111-bbd4-b4b1b354cef4"] ||
			plans["41781fb2-bc02-4b7c-bd55-b576c07bb09d"],
		aadPremiumP2:
			plans["84a661c4-e949-4bd2-a560-ed7766fcaf2b"] ||
			plans["eec0eb4f-6444-4f95-aba0-50c24d67f998"],
		aadBasic:
			plans["2b9c8e7c-319c-43a2-a2a0-48c5c6161de7"] ||
			plans["c4da7f8a-5ee2-4c99-a7e1-87d2df57f6fe"],
		aadBasicEdu: plans["1d0f309f-fdf9-4b2a-9ae7-9c48b91f1426"],
		aadSmb: plans["de377cbc-0019-4ec2-b77c-3f223947e102"],
		enterprisePackE3: plans["6fd2c87f-b296-42f0-b197-1e91e994b900"],
		enterprisePremiumE5: plans["c7df2760-2c81-4ef7-b578-5b5392b571df"],
		entraGovernance: plans["e866a266-3cff-43a3-acca-0c90a7e00c8b"],
	};

	return planEligibility.aadPremiumP2
		? "Microsoft Entra ID P2"
		: planEligibility.aadPremium
			? "Microsoft Entra ID P1"
			: planEligibility.aadBasic
				? "Microsoft Entra ID BASIC"
				: "Microsoft Entra ID FREE";
}
