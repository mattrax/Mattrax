import { discoverResponse, discoveryRequest } from "@mattrax/ms-mde/discovery";
import {
	enrollmentRequest,
	enrollmentResponse,
} from "@mattrax/ms-mde/enrollment";
import { policyRequest, policyResponse } from "@mattrax/ms-mde/policy";
import { deserializeXml, soapResponse } from "@mattrax/ms-mde/util";
import { datatype, wapProvisioningProfile } from "@mattrax/ms-mde/wap";
import { trace } from "@opentelemetry/api";
import { Hono } from "hono";
import { env } from "~/env";
import {
	identityCertificate,
	identityPrivateKey,
	microsoftDeviceIDExtension,
} from "../win/common";

export const enrollmentServerRouter = new Hono()
	.get("/Authenticate.svc", async (c) => {
		const appru = c.req.query("appru");
		if (!appru) return new Response("Missing appru", { status: 400 });
		return c.html(`<form method="post" action="${appru}">
    <p><input type="hidden" name="wresult" value="TODOSpecialTokenWhichVerifiesAuth" /></p>
    <input type="submit" value="Login" />
    </form>`);
	})
	.get("/ToS", async (c) => {
		const url = new URL(c.req.raw.url);

		const appru = url.searchParams.get("appru");
		// TODO: Style this error page
		if (!appru) return c.body("Missing appru!", { status: 400 });
		return c.html(
			`h3>AzureAD Term Of Service</h3>
<button onClick="acceptBtn()">Accept</button>
<script>
function acceptBtn() {
var urlParams = new URLSearchParams(window.location.search);

if (!urlParams.has('redirect_uri')) {
    alert('Redirect url not found. Did you open this in your broswer?');
} else {
    window.location = urlParams.get('redirect_uri') + "?IsAccepted=true&OpaqueBlob=TODOCustomDataFromAzureAD";
}
}
</script>`,
		);
	})
	.get("/Discovery.svc", async (c) => new Response(""))
	.post("/Discovery.svc", async (c) => {
		const span = trace.getActiveSpan();
		const traceId = span ? span.spanContext().traceId : "...";

		const req = deserializeXml(discoveryRequest, await c.req.text());
		if (!req.success) {
			// TODO: Handle XML errors with SOAP faults
			console.log(req);
			throw new Error("Error!");
		}

		const messageId = req.output["s:Envelope"]["s:Header"]["a:MessageID"];

		return soapResponse(
			discoverResponse(
				{
					authPolicy: "Federated",
					// TODO: Should this reflect this clients version/us error if we don't recognize it?
					enrollmentVersion: "5.0",
					enrollmentPolicyServiceUrl: `${env.VITE_PROD_ORIGIN}/EnrollmentServer/Policy.svc`,
					enrollmentServiceUrl: `${env.VITE_PROD_ORIGIN}/EnrollmentServer/Enrollment.svc`,
					authenticationServiceUrl: `${env.VITE_PROD_ORIGIN}/EnrollmentServer/Authenticate.svc`,
				},
				{
					relatesTo: messageId,
					correlationId: traceId,
					activityId: traceId,
				},
			),
		);
	})
	.post("/Policy.svc", async (c) => {
		const span = trace.getActiveSpan();
		const traceId = span ? span.spanContext().traceId : "...";

		const req = deserializeXml(policyRequest, await c.req.text());
		if (!req.success) {
			// TODO: Handle XML errors with SOAP faults
			for (const error of req.issues) {
				console.error("ISSUE", error.message, error.path, error);
			}
			console.log(JSON.stringify(req.output, null, 2));
			throw new Error("Error!");
		}
		const messageId = req.output["s:Envelope"]["s:Header"]["a:MessageID"];

		// TODO: Authentication

		// TODO: Client renewing it's own certificate

		// if cmd.Header.Action != policyActionRequest {
		// 	fault.Fault(fmt.Errorf("the request's action is not supported by the endpoint"), "the request was not destined for this endpoint", soap.FaultCodeActionMismatch)
		// 	return
		// } else if strings.Split(r.URL.String(), "?")[0] != strings.Split(cmd.Header.To, "?")[0] {
		// 	fault.Fault(fmt.Errorf("the request was destined for another server"), "the request was not destined for this server", soap.FaultCodeEndpointUnavailable)
		// 	return
		// }

		return soapResponse(
			policyResponse(
				{
					policyId: "mattrax-identity",
					policyFriendlyName: "Mattrax Device Authority Policy",
				},
				{
					relatesTo: messageId,
					correlationId: traceId,
					activityId: traceId,
				},
			),
		);
	})
	.post("/Enrollment.svc", async (c) => {
		const span = trace.getActiveSpan();
		const traceId = span ? span.spanContext().traceId : "...";

		const req = deserializeXml(enrollmentRequest, await c.req.text());
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
	});

export const managementServerRouter = new Hono().post(
	"/Manage.svc",
	async (c) => {
		const request = c.req.raw;

		const body = await request.text();

		// const apiGatewayAuth = request.headers.get("x-apigateway-auth");
		// const clientCert = request.headers.get("x-client-cert");

		const apiGatewayAuth = request.headers.get("x-apigateway-auth");
		const clientCert = request.headers.get("x-client-cert");

		console.log("MANAGEMENT", apiGatewayAuth, clientCert, body);

		// TODO: Authenticate client
		// TODO: Do management session

		return new Response("");
	},
);

async function todo(binarySecurityToken: string) {
	const { asn1, md, pki } = (await import("node-forge")).default;

	const authority = pki.certificateFromPem(identityCertificate);
	const authorityKey = pki.privateKeyFromPem(identityPrivateKey);

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
