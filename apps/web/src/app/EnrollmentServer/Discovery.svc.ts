import { discoverResponse, discoveryRequest } from "@mattrax/ms-mde/discovery";
import { deserializeXml, soapResponse } from "@mattrax/ms-mde/util";
import type { APIEvent } from "@solidjs/start/server";
import { env } from "~/env";

export const GET = () => new Response("");

export async function POST({ request }: APIEvent) {
	const traceId = "..."; // TODO: Figure this out???

	const req = deserializeXml(discoveryRequest, await request.text());
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
}
