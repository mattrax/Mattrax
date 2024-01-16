import { BaseSchema, Output, safeParse } from "valibot";
import { GetSessionResultWithData, getServerSession } from "./session";

export function unauthenticatedValidatedAction<TSchema extends BaseSchema, T>(
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

export function validatedAction<TSchema extends BaseSchema, T>(
  schema: TSchema,
  func: (
    session: GetSessionResultWithData,
    input: Output<TSchema>
  ) => T | Promise<T>
) {
  return async (formData: FormData): Promise<T> => {
    const rawInput: Record<string, unknown> = {};
    formData.forEach((value, key) => (rawInput[key] = value));

    const session = await getServerSession();
    if (session.data === undefined) throw new Error("Not authenticated"); // TODO: Proper results + handle on frontend

    const input = safeParse(schema, rawInput);
    console.log(session.data.id, input);
    if (input.success) {
      try {
        return func(
          // This is technically just `session` but this helps Typescript
          {
            ...session,
            data: session.data,
          },
          input.output
        );
      } catch (err) {
        console.error(err);
        throw err;
      }
    } else {
      throw new Error("Invalid input"); // TODO: Proper results + handle on frontend
    }
  };
}
