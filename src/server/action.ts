import { BaseSchema, Output, safeParse } from "valibot";

export function validatedAction<TSchema extends BaseSchema, T>(
  schema: TSchema,
  func: (input: Output<TSchema>) => T | Promise<T>
) {
  return async (formData: FormData): Promise<T> => {
    const rawInput: Record<string, unknown> = {};
    formData.forEach((value, key) => (rawInput[key] = value));

    const input = safeParse(schema, rawInput);
    if (input.success) {
      try {
        return func(input.output);
      } catch (err) {
        console.error(err);
        throw err;
      }
    } else {
      throw new Error("Invalid input"); // TODO: Proper results + handle on frontend
    }
  };
}
