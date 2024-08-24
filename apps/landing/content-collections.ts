import { defineCollection, defineConfig } from "@content-collections/core";

const docs = defineCollection({
	name: "docs",
	directory: "src/docs",
	include: "**/*.md",
	schema: (z) => ({
		title: z.string(),
	}),
});

export default defineConfig({
	collections: [docs],
});
