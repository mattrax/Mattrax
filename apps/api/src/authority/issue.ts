import { db, deviceAuthorities } from "~/db";

export async function issueAuthority() {
	console.log("Issueing a new MDM authority certificate");

	const { md, pki } = (await import("node-forge")).default;

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

	const publicKey = pki.certificateToPem(cert);
	const privateKey = pki.privateKeyToPem(keys.privateKey);
	const expiresAt = cert.validity.notAfter;

	await db.insert(deviceAuthorities).values({
		publicKey,
		privateKey,
		createdAt: cert.validity.notBefore,
		expiresAt,
	});

	console.log("Successfully issued a new MDM authority certificate");

	return {
		publicKey,
		privateKey,
		expiresAt,
	};
}
