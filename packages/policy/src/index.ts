import { z } from "zod";

export const configurationSchema = z.object({
  camera: z.boolean().optional(),
});

export type Policy = any; // TODO: Infer this from Zod

// TODO: Fractional indexing
// export const policySchema = z.array(configurationSchema);

// export function validatePolicy(policy: Input<typeof policySchema>) {
//   const data = safeParse(policySchema, policy);

//   console.log(data);
// }

// export function applyPolicy() {}

// TODO: XML builder
