import fs from "node:fs";
import path from "node:path";
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
	out: "./crates/mx-db/migrations",
	schema: "./apps/api/src/db/schema.ts",
	dialect: "mysql",
	dbCredentials: {
		url: process.env.DATABASE_URL!,
	},
	verbose: true,
	strict: true,
});

// Drizzle and refinery use different migration formats
process.on("exit", () => {
	const migrations = path.join("crates", "mx-db", "migrations");
	const refineryMigrations = path.join(migrations, "refinery");
	if (fs.existsSync(refineryMigrations)) {
		fs.rmdirSync(refineryMigrations, { recursive: true });
	}
	fs.mkdirSync(refineryMigrations);

	for (const fileName of fs.readdirSync(migrations)) {
		const p = path.join(migrations, fileName);
		if (!fs.lstatSync(p).isFile()) continue;

		const [num, ...rest] = path.parse(fileName).name.split("_");
		const src = fs.readFileSync(p, "utf-8");
		fs.writeFileSync(
			path.join(refineryMigrations, `V${num}__${rest.join("_")}.sql`),
			// @ts-expect-error
			src.replaceAll("--> statement-breakpoint", ""),
		);
	}

	console.log("Successfully converted Drizzle migrations to Refinery format!");
});
