import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

dotenv.config({
	path: "../.env",
});

if ("DATABASE_URL" in process.env === false)
	throw new Error("'DATABASE_URL' not set in env");

if (!process.env.DATABASE_URL?.startsWith("mysql://"))
	throw new Error(
		"DATABASE_URL must be a 'mysql://' URI. Drizzle Kit doesn't support the fetch adapter!",
	);

export default defineConfig({
	schema: "./apps/web/src/db/schema.ts",
	dialect: "mysql",
	dbCredentials: {
		url: process.env.DATABASE_URL!,
	},
	verbose: true,
	strict: true,
});
