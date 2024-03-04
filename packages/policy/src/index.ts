export type Policy = any; // TODO: Infer this from Zod

// TODO: Fractional indexing
// export const policySchema = z.array(configurationSchema);

// export function validatePolicy(policy: Input<typeof policySchema>) {
//   const data = safeParse(policySchema, policy);

//   console.log(data);
// }

// export function applyPolicy() {}

export { buildApplePolicy } from "./buildApple";
export {
	configurationSchema,
	type ConfigurationSchema,
} from "./configurationSchema";

export { slackImplementation } from "./implementations/slack";
