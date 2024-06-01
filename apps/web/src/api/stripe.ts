import { Resource } from "sst";
import { env } from "~/env";

export async function useStripe() {
	let secret: string | undefined;

	try {
		secret = Resource.StripeSecretKey.value;
	} catch {
		secret = env.STRIPE_SECRET_KEY;
	}

	if (!secret) throw new Error("Missing 'STRIPE_SECRET_KEY'");

	return import("stripe").then((mod) => {
		const Stripe = mod.default;

		return Object.assign(
			new Stripe(secret, {
				apiVersion: "2024-04-10",
				timeout: 1500,
				httpClient: Stripe.createFetchHttpClient(),
			}),
			{ secret },
		);
	});
}
