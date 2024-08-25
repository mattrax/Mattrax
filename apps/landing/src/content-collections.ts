import { defineCollection, defineConfig } from "@content-collections/core";
import { compileMarkdown } from "@content-collections/markdown";

const docs = defineCollection({
	name: "docs",
	directory: "../docs",
	include: "**/*.md",
	schema: (z) => ({
		title: z.string(),
		description: z.string().optional(),
		indexPage: z.boolean().default(false),
	}),
	transform: async (document, context) => {
		const html = await compileMarkdown(context, document);
		return {
			...document,
			html,
		};
	},
});

export default defineConfig({
	collections: [docs],
});
