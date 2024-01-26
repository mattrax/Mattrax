import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { hc } from "hono/client";
import { AppType } from "~/routes/api/[...api]";

export const client = hc<AppType>("");

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
