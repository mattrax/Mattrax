import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

dotenv.config({
	path: "../.env",
});

if ("DATABASE_URL" in process.env === false)
	throw new Error("'DATABASE_URL' not set in env");

export default defineConfig({
	out: "./schema",
	schema: "./apps/web/src/db/schema.ts",
	driver: "mysql2",
	dbCredentials: {
		uri: process.env.DATABASE_URL!,
	},
	verbose: true,
	strict: true,
});
