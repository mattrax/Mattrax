import {
	enrollmentRequest,
	enrollmentResponse,
} from "@mattrax/ms-mde/enrollment";
import { deserializeXml, soapResponse } from "@mattrax/ms-mde/util";
import { datatype, wapProvisioningProfile } from "@mattrax/ms-mde/wap";
import type { APIEvent } from "@solidjs/start/server";
import { getActiveAuthority } from "~/api/authority";
import { microsoftDeviceIDExtension } from "~/api/win/common";
import { env } from "~/env";

export async function POST({ request }: APIEvent) {
	const traceId = "..."; // TODO: Figure this out???

	const req = deserializeXml(enrollmentRequest, await request.text());
	if (!req.success) {
		// TODO: Handle XML errors with SOAP faults
		for (const error of req.issues) {
			console.error("ISSUE", error.message, error.path, error);
		}
		console.log(JSON.stringify(req.output, null, 2));
		throw new Error("Error!");
	}

	const messageId = req.output["s:Envelope"]["s:Header"]["a:MessageID"];
	const authBstRaw =
		req.output["s:Envelope"]["s:Header"]?.["wsse:Security"]?.[
			"wsse:BinarySecurityToken"
		]?.["#text"];
	if (!authBstRaw) throw new Error("TODO: Handle unauthorised");
	const authBst = atob(authBstRaw);

	// const deviceId = req.output['s:Envelope']['s:Body'];
	const enrollmentType = "Full"; // TODO: req.output["s:Envelope"]["s:Body"]["wst:RequestSecurityToken"]["ac:AdditionalContext"]["ac:ContextItem"].find((item) => item["ac:Name"] === "EnrollmentType")["ac:Value"];
	const csrRaw = atob(
		req.output["s:Envelope"]["s:Body"]["wst:RequestSecurityToken"][
			"wsse:BinarySecurityToken"
		]["#text"],
	);

	// @ts-expect-error
	const certStore = enrollmentType === "Device" ? "Device" : "User";

	if (authBst !== "TODOSpecialTokenWhichVerifiesAuth") {
		console.warn("Invalid authentication token!");
	}

	const [
		identityCertFingerprint,
		rootCertificateDer,
		signedClientCertFingerprint,
		clientCRTRaw,
	] = await todo(csrRaw);

	console.log(
		`Subject=${encodeURIComponent("CN=TODO")}&Stores=My%5C${certStore}`,
	);

	if (!identityCertFingerprint) throw new Error("TODO: Prevent this");
	if (!signedClientCertFingerprint) throw new Error("TODO: Prevent this");
	if (!rootCertificateDer) throw new Error("TODO: Prevent this");
	if (!clientCRTRaw) throw new Error("TODO: Prevent this");

	return soapResponse(
		enrollmentResponse(
			{
				wapProvisioningProfile: wapProvisioningProfile({
					CertificateStore: {
						Root: {
							System: {
								[identityCertFingerprint]: {
									EncodedCertificate: rootCertificateDer,
								},
							},
						},
						My: {
							[certStore]: {
								[signedClientCertFingerprint]: {
									EncodedCertificate: clientCRTRaw,
								},
								PrivateKeyContainer: {},
							},
						},
					},
					APPLICATION: {
						APPID: "w7",
						"PROVIDER-ID": "DEMO MDM",
						NAME: "Windows MDM Demo Server",
						ADDR: `${env.MANAGE_URL}/ManagementServer/Manage.svc`,
						ROLE: "4294967295",
						BACKCOMPATRETRYDISABLED: null, // TODO: handle this <parm name="BACKCOMPATRETRYDISABLED" />
						DEFAULTENCODING: "application/vnd.syncml.dm+xml",
						SSLCLIENTCERTSEARCHCRITERIA: `Subject=${encodeURIComponent(
							"CN=TODO",
						)}&Stores=My%5C${certStore}`,
						APPAUTH: [
							{
								AAUTHLEVEL: "CLIENT",
								AAUTHTYPE: "DIGEST",
								AAUTHSECRET: "dummy",
								AAUTHDATA: "nonce",
							},
							{
								AAUTHLEVEL: "APPSRV",
								AAUTHTYPE: "DIGEST",
								AAUTHNAME: "dummy",
								AAUTHSECRET: "dummy",
								AAUTHDATA: "nonce",
							},
						],
					},
					DMClient: {
						Provider: {
							"DEMO MDM": {
								Poll: {
									NumberOfFirstRetries: datatype(8),
								},
							},
						},
					},
				}),
			},
			{
				relatesTo: messageId,
				correlationId: traceId,
				activityId: traceId,
			},
		),
	);
}

async function todo(binarySecurityToken: string) {
	const { asn1, md, pki } = (await import("node-forge")).default;

	const [authority, authorityKey] = await getActiveAuthority();

	const csr = pki.certificationRequestFromAsn1(
		asn1.fromDer(binarySecurityToken),
	);

	console.log("CSR", csr.subject);

	const cert = pki.createCertificate();
	cert.version = csr.version;
	cert.signature = csr.signature;
	if (csr.publicKey) cert.publicKey = csr.publicKey;
	else console.error("No public key in CSR");
	// TODO: hook this up with SSLSearch thingo
	// cert.setSubject(csr.subject.attributes);
	cert.setSubject([
		{
			name: "commonName",
			value: "TODO", // TODO: commonName,
		},
	]);

	cert.setExtensions([
		{
			name: "basicConstraints",
			critical: true,
			cA: false,
		},
		{
			name: "keyUsage",
			critical: true,
			digitalSignature: true,
			keyEncipherment: true,
		},
		{
			name: "extKeyUsage",
			critical: true,
			clientAuth: true,
		},
		{
			id: microsoftDeviceIDExtension,
			value: "todo", // TODO: deviceId
		},
	]);

	// TODO: Hook this up
	cert.serialNumber = `${Number.parseInt(
		`${Math.floor(Math.random() * 1000000000000000000)}`,
		10,
	)}`;
	cert.setIssuer(authority.subject.attributes);
	cert.validity.notBefore = new Date();
	cert.validity.notAfter = new Date();
	cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
	cert.sign(authorityKey, md.sha256.create());

	const clientCert = asn1.toDer(pki.certificateToAsn1(cert)).getBytes();
	const ca = asn1.toDer(pki.certificateToAsn1(authority)).getBytes();

	return [
		await certificateSha1Fingerprint(ca),
		Buffer.from(ca, "binary").toString("base64"),
		await certificateSha1Fingerprint(clientCert),
		Buffer.from(clientCert, "binary").toString("base64"),
	];
}

const certificateSha1Fingerprint = async (msg: string) => {
	const { md } = (await import("node-forge")).default;
	return md.sha1.create().update(msg).digest().toHex().toUpperCase();
};
