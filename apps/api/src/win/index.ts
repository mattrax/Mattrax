import { Hono } from "hono";
import { env } from "~/env";
import {
	identityCertificate,
	identityPrivateKey,
	microsoftDeviceIDExtension,
	parser,
} from "../win/common";

export const enrollmentServerRouter = new Hono()
	.get("/EnrollmentServer/Authenticate.svc", async (c) => {
		const appru = c.req.query("appru");
		if (!appru) return new Response("Missing appru", { status: 400 });
		return c.html(`<form method="post" action="${appru}">
    <p><input type="hidden" name="wresult" value="TODOSpecialTokenWhichVerifiesAuth" /></p>
    <input type="submit" value="Login" />
    </form>`);
	})
	.get("/EnrollmentServer/ToS", async (c) => {
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
	.get("/EnrollmentServer/Discovery.svc", async (c) => new Response(""))
	.post("/EnrollmentServer/Discovery.svc", async (c) => {
		const request = c.req.raw;
		const url = new URL(request.url);

		const req = parser.parse(await request.text());

		const messageId = req["s:Envelope"]["s:Header"]["a:MessageID"];

		const b = `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:a="http://www.w3.org/2005/08/addressing">
	<s:Header>
		<a:Action s:mustUnderstand="1">http://schemas.microsoft.com/windows/management/2012/01/enrollment/IDiscoveryService/DiscoverResponse</a:Action>
		<ActivityId CorrelationId="8c6060c4-3d78-4d73-ae17-e8bce88426ee" xmlns="http://schemas.microsoft.com/2004/09/ServiceModel/Diagnostics">8c6060c4-3d78-4d73-ae17-e8bce88426ee</ActivityId>
		<a:RelatesTo>${messageId}</a:RelatesTo>
	</s:Header>
	<s:Body>
		<DiscoverResponse xmlns="http://schemas.microsoft.com/windows/management/2012/01/enrollment">
			<DiscoverResult>
				<AuthPolicy>Federated</AuthPolicy>
				<EnrollmentVersion>4.0</EnrollmentVersion>
				<EnrollmentPolicyServiceUrl>${url.origin}/EnrollmentServer/Policy.svc</EnrollmentPolicyServiceUrl>
				<EnrollmentServiceUrl>${url.origin}/EnrollmentServer/Enrollment.svc</EnrollmentServiceUrl>
				<AuthenticationServiceUrl>${url.origin}/EnrollmentServer/Authenticate.svc</AuthenticationServiceUrl>
			</DiscoverResult>
		</DiscoverResponse>
	</s:Body>
</s:Envelope>`;
		return new Response(b, {
			headers: {
				"Content-Type": "application/soap+xml; charset=utf-8",
				"Content-Length": b.length.toString(),
			},
		});
	})
	.post("/EnrollmentServer/Policy.svc", async (c) => {
		const request = c.req.raw;

		const req = parser.parse(await request.text());

		const messageId = req["s:Envelope"]["s:Header"]["a:MessageID"];

		const b = `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:a="http://www.w3.org/2005/08/addressing"><s:Header><a:Action s:mustUnderstand="1">http://schemas.microsoft.com/windows/pki/2009/01/enrollmentpolicy/IPolicy/GetPoliciesResponse</a:Action><ActivityId xmlns="http://schemas.microsoft.com/2004/09/ServiceModel/Diagnostics" CorrelationId="todo">todo</ActivityId><a:RelatesTo>urn:uuid:todo</a:RelatesTo></s:Header><s:Body xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><GetPoliciesResponse xmlns="http://schemas.microsoft.com/windows/pki/2009/01/enrollmentpolicy"><response><policyID>mattrax-identity</policyID><policyFriendlyName>Mattrax Identity Certificate Policy</policyFriendlyName><nextUpdateHours xsi:nil="true"></nextUpdateHours><policiesNotChanged xsi:nil="true"></policiesNotChanged><policies><policy><policyOIDReference>0</policyOIDReference><cAs xsi:nil="true"></cAs><attributes><policySchema>3</policySchema><privateKeyAttributes><minimalKeyLength>4096</minimalKeyLength><keySpec xsi:nil="true"></keySpec><keyUsageProperty xsi:nil="true"></keyUsageProperty><permissions xsi:nil="true"></permissions><algorithmOIDReference xsi:nil="true"></algorithmOIDReference><cryptoProviders xsi:nil="true"></cryptoProviders></privateKeyAttributes><supersededPolicies xsi:nil="true"></supersededPolicies><privateKeyFlags xsi:nil="true"></privateKeyFlags><subjectNameFlags xsi:nil="true"></subjectNameFlags><enrollmentFlags xsi:nil="true"></enrollmentFlags><generalFlags xsi:nil="true"></generalFlags><hashAlgorithmOIDReference>0</hashAlgorithmOIDReference><rARequirements xsi:nil="true"></rARequirements><keyArchivalAttributes xsi:nil="true"></keyArchivalAttributes><extensions xsi:nil="true"></extensions></attributes></policy></policies></response><cAs></cAs><oIDs><policyOIDReference>0</policyOIDReference><defaultName>szOID_OIWSEC_SHA256</defaultName><group>2</group><value>2.16.840.1.101.3.4.2.1</value></oIDs></GetPoliciesResponse></s:Body></s:Envelope>`;
		return new Response(b, {
			headers: {
				"Content-Type": "application/soap+xml; charset=utf-8",
				"Content-Length": b.length.toString(),
			},
		});
	})
	.post("/EnrollmentServer/Enrollment.svc", async (c) => {
		const request = c.req.raw;

		const body = await request.text();
		console.log(body);
		const req = parser.parse(body);
		console.log(JSON.stringify(req, null, 2));

		const messageId = req["s:Envelope"]["s:Header"]["a:MessageID"];
		const authBst = atob(
			req["s:Envelope"]["s:Header"]["wsse:Security"][
				"wsse:BinarySecurityToken"
			]["#text"],
		);
		// const deviceId = req['s:Envelope']['s:Body'];
		const enrollmentType = "Full"; // TODO: req["s:Envelope"]["s:Body"]["wst:RequestSecurityToken"]["ac:AdditionalContext"]["ac:ContextItem"].find((item) => item["ac:Name"] === "EnrollmentType")["ac:Value"];
		const csrRaw = atob(
			req["s:Envelope"]["s:Body"]["wst:RequestSecurityToken"][
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

		const wapProvisionProfile = `<?xml version="1.0" encoding="UTF-8"?>
	<wap-provisioningdoc version="1.1">
		<characteristic type="CertificateStore">
			<characteristic type="Root">
				<characteristic type="System">
					<characteristic type="${identityCertFingerprint}">
						<parm name="EncodedCertificate" value="${rootCertificateDer}" />
					</characteristic>
				</characteristic>
			</characteristic>
			<characteristic type="My">
				<characteristic type="${certStore}">
					<characteristic type="${signedClientCertFingerprint}">
						<parm name="EncodedCertificate" value="${clientCRTRaw}" />
					</characteristic>
					<characteristic type="PrivateKeyContainer" />
				</characteristic>
			</characteristic>
		</characteristic>
		<characteristic type="APPLICATION">
			<parm name="APPID" value="w7" />
			<parm name="PROVIDER-ID" value="DEMO MDM" />
			<parm name="NAME" value="Windows MDM Demo Server" />
			<parm name="ADDR" value="${env.MANAGE_URL}/ManagementServer/Manage.svc" />
			<parm name="ROLE" value="4294967295" />
			<parm name="BACKCOMPATRETRYDISABLED" />
			<parm name="DEFAULTENCODING" value="application/vnd.syncml.dm+xml" />
			<parm name="SSLCLIENTCERTSEARCHCRITERIA" value="Subject=${encodeURIComponent("CN=TODO")}&amp;Stores=My%5C${certStore}"/>
			<characteristic type="APPAUTH">
				<parm name="AAUTHLEVEL" value="CLIENT" />
				<parm name="AAUTHTYPE" value="DIGEST" />
				<parm name="AAUTHSECRET" value="dummy" />
				<parm name="AAUTHDATA" value="nonce" />
			</characteristic>
			<characteristic type="APPAUTH">
				<parm name="AAUTHLEVEL" value="APPSRV" />
				<parm name="AAUTHTYPE" value="DIGEST" />
				<parm name="AAUTHNAME" value="dummy" />
				<parm name="AAUTHSECRET" value="dummy" />
				<parm name="AAUTHDATA" value="nonce" />
			</characteristic>
		</characteristic>
		<characteristic type="DMClient">
			<characteristic type="Provider">
				<characteristic type="DEMO MDM">
					<characteristic type="Poll">
						<parm name="NumberOfFirstRetries" value="8" datatype="integer" />
					</characteristic>
				</characteristic>
			</characteristic>
		</characteristic>
	</wap-provisioningdoc>`;
		console.log("F");

		const wapProvisionProfileRaw = wapProvisionProfile
			.replaceAll("\n", "")
			.replaceAll("\t", "");
		const b = `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
	    xmlns:a="http://www.w3.org/2005/08/addressing"
	    xmlns:u="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
	    <s:Header>
	        <a:Action s:mustUnderstand="1">http://schemas.microsoft.com/windows/pki/2009/01/enrollment/RSTRC/wstep</a:Action>
	        <a:RelatesTo>${messageId}</a:RelatesTo>
	        <o:Security xmlns:o="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" s:mustUnderstand="1">
	            <u:Timestamp u:Id="_0">
	                <u:Created>2018-11-30T00:32:59.420Z</u:Created>
	                <u:Expires>2018-12-30T00:37:59.420Z</u:Expires>
	            </u:Timestamp>
	        </o:Security>
	    </s:Header>
	    <s:Body>
	        <RequestSecurityTokenResponseCollection xmlns="http://docs.oasis-open.org/ws-sx/ws-trust/200512">
	            <RequestSecurityTokenResponse>
	                <TokenType>http://schemas.microsoft.com/5.0.0.0/ConfigurationManager/Enrollment/DeviceEnrollmentToken</TokenType>
	                <DispositionMessage xmlns="http://schemas.microsoft.com/windows/pki/2009/01/enrollment"></DispositionMessage>
	                <RequestedSecurityToken>
	                    <BinarySecurityToken xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" ValueType="http://schemas.microsoft.com/5.0.0.0/ConfigurationManager/Enrollment/DeviceEnrollmentProvisionDoc" EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd#base64binary">${btoa(
												wapProvisionProfileRaw,
											)}</BinarySecurityToken>
	                </RequestedSecurityToken>
	                <RequestID xmlns="http://schemas.microsoft.com/windows/pki/2009/01/enrollment">0</RequestID>
	            </RequestSecurityTokenResponse>
	        </RequestSecurityTokenResponseCollection>
	    </s:Body>
	</s:Envelope>`;
		console.log("E", b);
		return new Response(b, {
			headers: {
				"Content-Type": "application/soap+xml; charset=utf-8",
				"Content-Length": b.length.toString(),
			},
		});
	});

export const managementServerRouter = new Hono().post("", async (c) => {
	const request = c.req.raw;

	const body = await request.text();

	const apiGatewayAuth = request.headers.get("x-apigateway-auth");
	const clientCert = request.headers.get("x-client-cert");

	console.log("MANAGEMENT", apiGatewayAuth, clientCert, body);

	// TODO: Authenticate client
	// TODO: Do management session

	return new Response("");
});

async function todo(binarySecurityToken: string) {
	const { asn1, md, pki } = await import("node-forge");

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
	cert.serialNumber = `${Number.parseInt(`${Math.floor(Math.random() * 1000000000000000000)}`, 10)}`;
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
	const { md } = await import("node-forge");
	return md.sha1.create().update(msg).digest().toHex().toUpperCase();
};
