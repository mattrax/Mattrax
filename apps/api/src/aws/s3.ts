import { aws } from ".";

// Get an object from an S3 bucket
// *Note* all error handling is left to the caller as it's very context specific.
export async function getObject(
	bucketName: string,
	region: string,
	key: string,
	params?: RequestInit,
) {
	if (!aws.client)
		throw new Error("Attempted getObject without valid AWS credentials");
	return await aws.client.fetch(
		`https://${bucketName}.s3.${region}.amazonaws.com/${key}`,
		params,
	);
}

// Put an object into an S3 bucket
export async function putObject(
	bucketName: string,
	region: string,
	key: string,
	body: BodyInit,
	params?: RequestInit,
) {
	if (!aws.client)
		throw new Error("Attempted getObject without valid AWS credentials");
	const resp = await aws.client.fetch(
		`https://${bucketName}.s3.${region}.amazonaws.com/${key}`,
		{
			method: "PUT",
			body,
			...params,
		},
	);
	if (!resp.ok)
		throw new Error(
			`Failed to put to bucket '${bucketName}' object '${key}': ${resp.statusText}`,
		);
	return resp;
}
