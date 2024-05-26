import { env } from "~/env";

export async function useStripe() {
	if (!env.STRIPE_SECRET_KEY) throw new Error("Missing 'STRIPE_SECRET_KEY'");

	return import("stripe").then((mod) => {
		const Stripe = mod.default;

		return new Stripe(env.STRIPE_SECRET_KEY!, {
			apiVersion: "2024-04-10",
			timeout: 1500,
			httpClient: Stripe.createFetchHttpClient(),
		});
	});
}
