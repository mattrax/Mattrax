import { BaseSchema, Input, Output, safeParse } from "valibot";

type ObjectFieldsOptional<T> = {
  [P in keyof T]: T[P] | undefined;
};

export function validateEnv<T extends BaseSchema>(
  schema: T,
  env: ObjectFieldsOptional<Input<T>>,
  context: "server" | "client" = "server"
): Output<T> {
  // if (process.env.SKIP_ENV_VALIDATION) {}
  // TODO: skip validation if SKIP_ENV_VALIDATION is set

  if (!import.meta.env.SSR) {
    if (context === "server") {
      return new Proxy(
        {},
        {
          get: () => {
            throw new Error("Cannot access env on the client");
          },
        }
      );
    }
  }

  const result = safeParse(schema, env);

  if (!result.success) {
    for (const issue of result.issues) {
      console.error(issue); // TODO: Render this nicely
    }
    throw new Error("Invalid environment variables");
  }

  return result.output;
}
