import { z } from "zod";

export const definePolicy = <const P extends PolicyDefinition>(policy: P) =>
  policy;

export type Policy = {
  title: string;
  description: string;
  schema: z.ZodType;
};

export type PolicyDefinition = Record<string, Policy>;

export type InferPolicyData<P extends PolicyDefinition> = {
  [K in keyof P]?: z.infer<P[K]["schema"]>;
};
