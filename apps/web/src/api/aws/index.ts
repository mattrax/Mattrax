import { AwsClient } from "aws4fetch";
import { env, withEnv } from "~/env";

export const aws = withEnv(() => {
	let client: AwsClient | undefined;

	if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY)
		client = new AwsClient({
			accessKeyId: env.AWS_ACCESS_KEY_ID,
			secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
		});

	return { client };
});
