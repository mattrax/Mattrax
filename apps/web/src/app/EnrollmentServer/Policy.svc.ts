import { policyRequest, policyResponse } from "@mattrax/ms-mde/policy";
import { deserializeXml, soapResponse } from "@mattrax/ms-mde/util";
import type { APIEvent } from "@solidjs/start/server";

export async function POST({ request }: APIEvent) {
	const traceId = "..."; // TODO: Figure this out???

	const req = deserializeXml(policyRequest, await request.text());
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
}
