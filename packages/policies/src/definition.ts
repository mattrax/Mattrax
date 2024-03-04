import { z } from "zod";

export const definePolicy = <const P extends PolicyDefinition>(policy: P) =>
	policy;

export type Policy = {
	title: string;
	description: string;
	supported: Platform[];
	schema: z.ZodType;
};

export type Platform =
	| "macOS"
	| "IOS"
	| "iPadOS"
	| "tvOS"
	| "visionOS"
	| "Windows"
	| "Android"
	| "Linux";

export type PolicyDefinition = Record<string, Policy>;

export type InferPolicyData<P extends PolicyDefinition> = {
	[K in keyof P]?: z.infer<P[K]["schema"]>;
};

export type InferPolicySupportedPlatforms<P extends PolicyDefinition> = {
	[K in keyof P]: P[K]["supported"];
}[keyof P];

// https://ja.nsommer.dk/articles/type-checked-unique-arrays.html
export type InArray<T, X> =
	// See if X is the first element in array T
	T extends readonly [X, ...infer _Rest]
		? true
		: // If not, is X the only element in T?
		  T extends readonly [X]
		  ? true
		  : // No match, check if there's any elements left in T and loop recursive
			  T extends readonly [infer _, ...infer Rest]
			  ? InArray<Rest, X>
			  : // There's nothing left in the array and we found no match
				  false;
