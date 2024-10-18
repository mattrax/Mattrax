import { updateDomainName } from "~/aws/apiGateway";
import { putObject } from "~/aws/s3";
import { env } from "~/env";
import { TRUSTSTORE_ACTIVE_AUTHORITY, TRUSTSTORE_BUCKET_REGION } from ".";

export const TRUSTSTORE_POOL = "truststore.pem";

export async function issueAuthority(existingTruststore: string | undefined) {
	// It's intended that the caller handle this properly
	if (!env.TRUSTSTORE_BUCKET)
		throw new Error(
			"Attempted to issue authority and 'TRUSTSTORE_BUCKET' not set. This should be unreachable!",
		);

	console.log("Issueing a new MDM authority certificate");

	const { asn1, md, pki } = (await import("node-forge")).default;

	const keys = pki.rsa.generateKeyPair(4096);

	const cert = pki.createCertificate();
	cert.publicKey = keys.publicKey;
	cert.serialNumber = "01";
	cert.validity.notBefore = new Date();
	cert.validity.notAfter = new Date();
	cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
	const attrs = [
		{ name: "commonName", value: "Mattrax Device Authority" },
		{ name: "organizationName", value: "Mattrax Inc." },
	];
	cert.setSubject(attrs);
	cert.setIssuer(attrs);

	cert.setExtensions([
		{
			name: "basicConstraints",
			critical: true,
			cA: true,
		},
		{
			name: "keyUsage",
			critical: true,
			keyCertSign: true,
			cRLSign: true,
		},
	]);

	cert.sign(keys.privateKey, md.sha256.create());

	const certPem = pki.certificateToPem(cert);
	const keyPem = pki.privateKeyToPem(keys.privateKey);
	const activeAuthority = `${certPem}\n---\n${keyPem}`;
	const date = new Date();

	// If we start issuing an authority on the minute boundary we could end up with two authorities being issued at the same time (one for each minute),
	// as the running on this function for the first minute will overlap into the second minute.
	// This will wait up to 10 seconds if needed to ensure we are not running near the minute boundary. It will suck for UX but this should be a very rare case to hit.
	// This acts as a mitigation but if this function takes more than 10 seconds it's still *technically* possible for a race condition.
	// In reality this is stupidly unlikely and is an acceptable risk for now.
	if (date.getSeconds() > 50)
		await new Promise((resolve) =>
			setTimeout(resolve, (60 - date.getSeconds()) * 1000),
		);

	// We do this first to ensure we always have a proper backup of *any* issued authority
	// It's possible we generate this authority and fail to switch to it as the active one
	// and that's fine, we just can't afford the inverse of setting an active authority and not having a backup!
	await putObject(
		env.TRUSTSTORE_BUCKET,
		TRUSTSTORE_BUCKET_REGION,
		`history/${constructKey(date)}`,
		activeAuthority,
		{
			headers: {
				// Due to the fact the key is keyed to the current minute of the day, and we prevent a put if the key already exists,
				// we can be pretty certain we aren't going to be issuing two authorities at the same time. Refer to the comment above for more info about the minute boundary.
				"If-None-Match": "*",
				"Cache-Control": "private, max-age=604800, immutable",
			},
		},
	);

	// We ensure we update the truststore before we set this identity as the active one to ensure no disruption to the service.
	const truststorePoolPut = await putObject(
		env.TRUSTSTORE_BUCKET,
		TRUSTSTORE_BUCKET_REGION,
		TRUSTSTORE_POOL,
		`${existingTruststore ? `${existingTruststore}\n` : ""}${certPem}`,
	);
	console.log(truststorePoolPut.headers); // TODO
	const truststoreVersion = truststorePoolPut.headers.get("x-amz-version-id");
	if (!truststoreVersion) throw new Error("Failed to get truststore version");

	// REF[0]
	// It's okay to cache the active authority, but it's *never* okay to cache the truststore pool.
	// When the active authority changes, it's fine if device certificates remain being issued with the old authority for a short period of time.
	// However, if the truststore doesn't reflect the active authority being used, clients will be unable to communicate with the management server until the cache expires.

	// Technically these can be done at the same time but API gateway takes a bit to pick up the S3 change so this helps to delay it.
	await putObject(
		env.TRUSTSTORE_BUCKET,
		TRUSTSTORE_BUCKET_REGION,
		TRUSTSTORE_ACTIVE_AUTHORITY,
		activeAuthority,
		{
			headers: {
				"Cache-Control": `private, max-age=${24 * 60 * 60}`,
			},
		},
	);

	if (env.API_GATEWAY_DOMAIN && env.TRUSTSTORE_BUCKET)
		await updateDomainName(env.API_GATEWAY_DOMAIN!, "us-east-1", {
			domainNameConfigurations: [
				{
					endpointType: "REGIONAL",
					certificateArn: env.CERTIFICATE_ARN!,
					securityPolicy: "TLS_1_2",
				},
			],
			mutualTlsAuthentication: {
				truststoreUri: `s3://${env.TRUSTSTORE_BUCKET}/${TRUSTSTORE_POOL}`,
				truststoreVersion,
			},
		});

	console.log("Successfully issued a new MDM authority certificate");
	return activeAuthority;
}

function constructKey(date: Date) {
	return `${date.getFullYear().toFixed(0).padStart(4, "0")}-${(date.getMonth() + 1).toFixed(0).padStart(2, "0")}-${date.getDate().toFixed(0).padStart(2, "0")}T${date.getHours().toFixed(0).padStart(2, "0")}:${date.getMinutes().toFixed(0).padStart(2, "0")}`;
}
