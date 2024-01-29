import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { hc } from "hono/client";
import { AppType } from "~/routes/api/[...api]";

// TODO: Move into `resource.ts` file
export const client = hc<AppType>(location.origin);

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
