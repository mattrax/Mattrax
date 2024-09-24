import type { APIEvent } from "@solidjs/start/server";
import pkg from "node-forge";
import {
	identityCertificate,
	identityPrivateKey,
	microsoftDeviceIDExtension,
	parser,
} from "./common";

// TODO: Surley this can be done better
const { asn1, md, pki } = pkg;

// TODO: From env
const manageOrigin = "https://demo3.otbeaumont.me";

export async function POST({ request }: APIEvent) {
	console.log("POST /EnrollmentServer/Enrollment.svc");

	const body = await request.text();
	console.log(body);
	const req = parser.parse(body);
	console.log(JSON.stringify(req, null, 2));

	const messageId = req["s:Envelope"]["s:Header"]["a:MessageID"];
	const authBst = atob(
		req["s:Envelope"]["s:Header"]["wsse:Security"]["wsse:BinarySecurityToken"][
			"#text"
		],
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
	] = todo(csrRaw);

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
			<parm name="ADDR" value="${manageOrigin}/ManagementServer/Manage.svc" />
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
}

function todo(binarySecurityToken: string) {
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
		certificateSha1Fingerprint(ca),
		Buffer.from(ca, "binary").toString("base64"),
		certificateSha1Fingerprint(clientCert),
		Buffer.from(clientCert, "binary").toString("base64"),
	];
}

const certificateSha1Fingerprint = (msg: string): string => {
	return md.sha1.create().update(msg).digest().toHex().toUpperCase();
};
