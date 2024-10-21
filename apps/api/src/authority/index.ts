import { gt, lt } from "drizzle-orm";
import type { pki } from "node-forge";
import { db, deviceAuthorities } from "~/db";

// We cache between invocations of the code
let certCache:
	| {
			publicKey: string;
			privateKey: string;
			cachedAt: Date;
	  }
	| undefined = undefined;
let truststores:
	| {
			certs: pki.Certificate[];
			cachedAt: Date;
	  }
	| undefined = undefined;

const cacheValidityPeriod = 15 * 60 * 1000; // 15 minutes

// Get the public and private keypair for the active MDM authority certificates used for issuing new client certificates.
export async function getActiveAuthority(shouldRenew = false) {
	const { pki } = (await import("node-forge")).default;

	if (
		!certCache ||
		// Refresh the local cache if it's older than 15 minutes
		(certCache.cachedAt.getTime() - new Date().getTime()) / 1000 / 60 > 15
	) {
		let [result] = await db
			.select({
				publicKey: deviceAuthorities.publicKey,
				privateKey: deviceAuthorities.privateKey,
				expiresAt: deviceAuthorities.expiresAt,
			})
			.from(deviceAuthorities)
			// We want to grab the latest certificate
			.orderBy(deviceAuthorities.createdAt)
			// but we avoid using any certs issued for a while to ensure it has time to propagate
			// because we don't wanna sign the device cert and then the device talks with a server without the new cert yet.
			.where(
				gt(
					deviceAuthorities.expiresAt,
					new Date(new Date().getTime() - cacheValidityPeriod * 2),
				),
			)
			.limit(1); // TODO: Filter out new certs for a while to ensure they can progate once issued

		if (!result) result = await (await import("./issue")).issueAuthority();

		// If the authority is 15 days from expiring and asked renew it
		if (
			// We explicitly require this so that we don't run into race conditions if many devices are trying to enroll at once.
			// The expectation is this is only set in a cron job.
			shouldRenew &&
			(result.expiresAt.getTime() - new Date().getTime()) /
				1000 /
				60 /
				60 /
				24 <
				15
		) {
			console.log(
				`Detected authority certificate is about to expire at ${result.expiresAt.toString()}, renewing`,
			);
			result = await (await import("./issue")).issueAuthority();
		}

		certCache = {
			publicKey: result.publicKey,
			privateKey: result.privateKey,
			cachedAt: new Date(),
		};
	}

	return [
		pki.certificateFromPem(certCache.publicKey),
		pki.privateKeyFromPem(certCache.privateKey),
	] as const;
}

// Get all of the public keys for active MDM authority certificates
export async function getAuthorityTruststore() {
	if (
		!truststores ||
		// Refresh the local cache if it's older than 15 minutes
		truststores.cachedAt.getTime() - new Date().getTime() > cacheValidityPeriod
	) {
		const { pki } = (await import("node-forge")).default;

		const result = await db
			.select({
				publicKey: deviceAuthorities.publicKey,
			})
			.from(deviceAuthorities)
			// We only want to trust certificates that are still valid
			.where(gt(deviceAuthorities.expiresAt, new Date()));

		truststores = {
			certs: result.map((v) => pki.certificateFromPem(v.publicKey)),
			cachedAt: new Date(),
		};
	}

	return truststores.certs;
}
