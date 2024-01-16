import { Input, boolean, object, optional, safeParse } from "valibot";

export const policySchema = object({
  camera: optional(boolean()),
});

export function validatePolicy(policy: Input<typeof policySchema>) {
  const data = safeParse(policySchema, policy);

  console.log(data);
}

// export function applyPolicy() {}

// TODO: XML builder
