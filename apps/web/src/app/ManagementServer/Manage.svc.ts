import type { APIEvent } from "@solidjs/start/server";
import { getAuthorityTruststore } from "~/api/authority";

export async function POST({ request }: APIEvent) {
	const body = await request.text();

	// TODO: Authenticate this came from the mTLS proxy

	const clientCertRaw = request.headers.get("x-client-cert");
	if (!clientCertRaw) {
		// TODO: Proper error handling???
		return new Response("No client cert", { status: 400 });
	}

	// console.log("GOT", atob(clientCertRaw)); // TODO

	const { asn1, pki } = (await import("node-forge")).default;

	// TODO: Why do we need to double base64 decode?
	const clientCert = pki.certificateFromAsn1(asn1.fromDer(atob(clientCertRaw)));
	const expectedCerts = await getAuthorityTruststore();

	const isTrusted = expectedCerts.some((cert) => {
		try {
			return cert.verify(clientCert);
		} catch (e) {
			console.error(e);
			return false;
		}
	});

	if (!isTrusted)
		return new Response("Client cert not trusted", { status: 400 });

	console.log("MANAGEMENT", clientCertRaw, body);

	// TODO: Authenticate client
	// TODO: Do management session

	return new Response("");
}
