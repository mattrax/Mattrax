import { useParams } from "@solidjs/router";
import { createMemo } from "solid-js";
import { z } from "zod";

export function useZodParams<S extends z.ZodRawShape>(schema: S) {
  const zodSchema = z.object(schema);
  const params = useParams();

  // TODO: Does this properly ensure fine-grained updates on the result or do we need a system with `reconcile`???
  return createMemo(() => {
    const parsed = zodSchema.safeParse(params);
    if (!parsed.success) {
      throw new Error("Invalid params"); // TODO: Error handling (toast + redirect???)
    }
    return parsed.data;
  });
}
