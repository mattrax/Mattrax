import type { APIEvent } from "@solidjs/start/server";
import { parser } from "./common";

export function GET({ request }: APIEvent) {
	console.log("GET /EnrollmentServer/Discovery.svc");

	return new Response("");
}

export async function POST({ request }: APIEvent) {
	console.log("POST /EnrollmentServer/Discovery.svc");

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
}
