import { hc } from "hono/client";
import { AppType } from "~/routes/api/[...api]";

export const client = hc<AppType>("");
