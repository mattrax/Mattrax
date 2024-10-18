import { getObject } from "~/aws/s3";
import { env } from "~/env";
import { identityCertificate, identityPrivateKey } from "~/win/common";

// TODO: For better self-hosting we are probs gonna wanna have R2 as our main storage and replicate to S3 where required.
// Why S3? Because API Gateway handles TLS terminations and it requires the certificate pool to be in S3.

export const TRUSTSTORE_BUCKET_REGION = "us-east-1";
export const TRUSTSTORE_ACTIVE_AUTHORITY = "authority";

// Get the public and private keypair for the active MDM authority certificates used for issuing new client certificates.
export async function getMDMAuthority() {
	// if (!env.TRUSTSTORE_BUCKET) return undefined;

	// const activeAuthority = await getObject(
	// 	env.TRUSTSTORE_BUCKET,
	// 	TRUSTSTORE_BUCKET_REGION,
	// 	TRUSTSTORE_ACTIVE_AUTHORITY,
	// 	{
	// 		// This is okay. Search for the `REF[0]` comment for explanation.
	// 		// @ts-expect-error // TODO: Fix this type error
	// 		cf: {
	// 			// Cache for 1 day
	// 			cacheTtl: 24 * 60 * 60,
	// 			cacheEverything: true,
	// 		},
	// 	},
	// );
	// let activeAuthorityRaw: string;
	// if (activeAuthority.status === 404) {
	// 	activeAuthorityRaw = await (await import("./issue")).issueAuthority("");
	// } else if (!activeAuthority.ok)
	// 	throw new Error(
	// 		`Failed to get '${TRUSTSTORE_ACTIVE_AUTHORITY}' from bucket '${env.TRUSTSTORE_BUCKET}' with status ${activeAuthority.statusText}: ${await activeAuthority.text()}`,
	// 	);
	// else activeAuthorityRaw = await activeAuthority.text();

	// const parts = activeAuthorityRaw.split("\n---\n");
	// if (parts.length !== 2) throw new Error("Authority file is malformed");

	const { pki } = (await import("node-forge")).default;

	// return [
	// 	pki.certificateFromPem(parts[0]!),
	// 	pki.privateKeyFromPem(parts[1]!),
	// ] as const;

	return [
		pki.certificateFromPem(identityCertificate),
		pki.privateKeyFromPem(identityPrivateKey),
	];
}
