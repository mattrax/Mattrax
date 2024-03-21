export function GET() {
	// TODO: Generate this from the Rust types using Specta

	return Response.json({
		$schema: "https://json-schema.org/draft/2020-12/schema",
		$id: "https://mattrax.app/policy.schema.json",
		title: "Policy",
		description: "A configuration policy",
		type: "object",
		additionalProperties: false,
		properties: {
			testing: {
				description: "The unique identifier for a product",
				type: "string",
			},
		},
	});
}
