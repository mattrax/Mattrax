import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export type Database = ReturnType<typeof createDb>;

export const createDb = (d1: D1Database) => drizzle(d1, { schema });
