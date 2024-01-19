import { z } from "zod";

export const configurationSchema = z.object({
  camera: z.boolean().optional(),
});

export type ConfigurationSchema = z.infer<typeof configurationSchema>;
