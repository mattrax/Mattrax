import { createServer } from "node:http";
import { createServerAdapter } from "@whatwg-node/server";
import { apiRoutes } from "../config.js";

export function plugin() {
	const match = new RegExp(
		`(^(${apiRoutes.map((r) => `^${r.replaceAll("/", "\\/").replaceAll("*", ".*")}`).join("|")}))`,
		"gm",
	);
	let config;
	let s;

	return {
		name: "mattrax:dev",

		config(config) {
			if (!config.server) config.server = {};
			if (!config.server.proxy) config.server.proxy = {};
			config.server.proxy = {
				...config.server.proxy,
				...Object.fromEntries(
					apiRoutes.map((r) => [
						r.replaceAll("/*", ""),
						"http://localhost:9038",
					]),
				),
			};
		},

		configResolved(_config) {
			config = _config;
		},

		configureServer(server) {
			if (config.inlineConfig.router.name !== "ssr") return;

			s = createServer(async (req, res, next) => {
				try {
					const m = await server.ssrLoadModule("@mattrax/api/worker");
					if (!m.default)
						throw new Error("No `default` export found in server module.");
					if (!m.default.fetch)
						throw new Error("No `fetch` export found in server module.");
					await createServerAdapter(m.default.fetch).handle(req, res, next);
				} catch (err) {
					console.error(err);
					res.writeHead(500);
					res.end("Internal Server Error");
				}
				return;
			});
			s.listen(9038);
			process.on("exit", (code) => s.close());

			// TODO: This is not working as expected, probs a Vinxi thing.
			// server.middlewares.use(async (req, res, next) => {
			// 	// console.log("API request", req.url, req.url && match.test(req.url));
			// 	if (req.url && match.test(req.url)) {
			// 		try {
			// 			const m = await server.ssrLoadModule("@mattrax/api/worker");
			// 			if (!m.default)
			// 				throw new Error("No `default` export found in server module.");
			// 			if (!m.default.fetch)
			// 				throw new Error("No `fetch` export found in server module.");
			// 			// console.log(createServerAdapter(m.default.fetch));
			// 			// console.log(
			// 			// 	await createServerAdapter(m.default.fetch).handle(req, res, next),
			// 			// );
			// 			// TODO: m.default.fetch
			// 			await createServerAdapter(() => new Response("TODO")).handle(
			// 				req,
			// 				res,
			// 				next,
			// 			);
			// 		} catch (err) {
			// 			console.error(err);
			// 			res.status(500);
			// 			res.end("Internal Server Error");
			// 		}
			// 		return;
			// 	}
			// 	next();
			// });
		},

		buildEnd() {
			if (s) s.close();
		},
	};
}
