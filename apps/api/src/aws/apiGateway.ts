import { aws } from ".";

// TODO
export async function updateDomainName(
	domain: string,
	region: string,
	body: any,
) {
	if (!aws.client)
		throw new Error("Attempted updateDomainName without valid AWS credentials");
	const resp = await aws.client.fetch(
		`https://apigateway.${region}.amazonaws.com/v2/domainnames/${domain}`,
		{
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		},
	);
	if (!resp.ok)
		throw new Error(
			`Failed to update '${domain}' with status ${resp.statusText}: ${await resp.text()}`,
		);
	// TODO
	console.log(await resp.text());
}
