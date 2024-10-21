import type { ExecutionContext } from "@cloudflare/workers-types";
import {
	type TrpcServerFunctionOpts,
	trpcServerFunction,
} from "@mattrax/trpc-server-function";
import { toReadableStream } from "@mattrax/trpc-server-function/seroval";
import { instrument } from "@microlabs/otel-cf-workers";
import { trace } from "@opentelemetry/api";
import { type Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import type { BlankEnv, BlankInput } from "hono/types";
import { provideRequestEvent } from "solid-js/web/storage";
import { getActiveAuthority } from "./authority";
import { env } from "./env";
import { createTRPCContext, router } from "./trpc";
import { waitlistRouter } from "./waitlist";
import { enrollmentServerRouter, managementServerRouter } from "./win";

declare module "solid-js/web" {
	interface RequestEvent {
		hono: Context<BlankEnv, "/api/trpc", BlankInput>;
		waitUntil(promise: Promise<void> | (() => Promise<void>)): void;
		// TODO: Tie to `wrangler.toml`'s generated types?
		env: Record<string, unknown>;
	}
}

const GIT_SHA = (import.meta.env as any)?.GIT_SHA || "unknown";

const app = new Hono()
	.onError((err, c) => {
		console.error(err);
		if (err instanceof HTTPException) return err.getResponse();
		trace.getActiveSpan()?.recordException(err);
		return c.json({ error: "Internal Server Error" }, 500);
	})
	.use((c, next) =>
		provideRequestEvent(
			{
				hono: c,
				request: c.req.raw,
				waitUntil: c.executionCtx.waitUntil as any,
				env: c.env as any,
				// SS's stuff is still being injected via Vite.
				locals: {},
				response: c.res,
				nativeEvent: undefined as any,
			},
			() => next(),
		),
	);

if (import.meta.env.DEV) app.use(logger());

app
	.get("/api/__version", (c) => c.json(GIT_SHA))
	.route("/api/waitlist", waitlistRouter)
	.get("/api/__cron", async (c) => {
		if (c.req.query("secret") !== env.INTERNAL_SECRET) {
			c.status(403);
			return c.json({ error: "Forbidden" });
		}

		// TODO: Hook this up to a proper Cloudflare CRON
		await getActiveAuthority(true);

		return c.text("ok");
	})
	.all("/api/trpc", async (c) => {
		const opts: TrpcServerFunctionOpts = await c.req.json();
		const result = await trpcServerFunction({
			router,
			ctx: createTRPCContext(),
			opts,
		});

		c.header("Content-Type", "text/javascript");
		c.status(200);
		const resp = c.body(toReadableStream(result));
		// TODO: For some reason the `c.header` above isn't always respected.
		resp.headers.set("Content-Type", "text/javascript");
		return resp;
	})
	.route("/EnrollmentServer", enrollmentServerRouter)
	.route("/ManagementServer", managementServerRouter)
	.all("*", (c) => {
		c.status(404);
		if (c.req.raw.headers.get("Accept")?.includes("application/json")) {
			return c.json({ error: "Not Found" });
		}
		return c.text("404: Not Found");
	});

// TODO: Codegen from `wrangler.toml`
type Env = Record<string, any>;

// We disable this in dev because it doesn't play nice with Vite's devserver (due it trying to instrument CF stuff that doesn't exist).
const instrumented = import.meta.env.DEV
	? undefined
	: instrument(
			{
				fetch: async (request: Request, env: Env, ctx: ExecutionContext) => {
					const resp = await app.fetch(request, env, ctx);
					const spanCtx = trace.getActiveSpan();
					if (spanCtx)
						resp.headers.set("x-trace-id", spanCtx.spanContext().traceId);
					return resp;
				},
			},
			(env) => {
				return {
					service: { name: "web", version: GIT_SHA },
					exporter: {
						url: "https://api.axiom.co/v1/traces",
						headers: {
							Authorization: `Bearer ${env.AXIOM_API_TOKEN}`,
							"X-Axiom-Dataset": `${env.AXIOM_DATASET}`,
						},
					},
				};
			},
		);

const _log = console.log;
console.log = (...args) => {
	_log(...args);
	trace.getActiveSpan()?.addEvent("log", { args });
};
const _error = console.error;
console.error = (...args) => {
	_error(...args);
	trace.getActiveSpan()?.addEvent("error", { args });
};
const _warn = console.warn;
console.warn = (...args) => {
	_warn(...args);
	trace.getActiveSpan()?.addEvent("warn", { args });
};
const _trace = console.trace;
console.trace = (...args) => {
	_trace(...args);
	trace.getActiveSpan()?.addEvent("trace", { args });
};

export default {
	fetch: async (request: Request, env: Env, ctx: ExecutionContext) => {
		// biome-ignore lint/style/noParameterAssign: In dev you get `ctx` as `env` type thing so we override.
		if (import.meta.env.DEV) env = process.env;
		if (!ctx)
			// biome-ignore lint/style/noParameterAssign:
			ctx = {
				waitUntil: (p) =>
					// If we don't catch it will panic the node devserver.
					p.catch((err) => console.error("Failed waitUntil:", err)),
				passThroughOnException: () => {},
			};

		const isAxiom = "AXIOM_API_TOKEN" in env && "AXIOM_DATASET" in env;
		return await (isAxiom && !!instrumented
			? instrumented.fetch(request, env, ctx)
			: app.fetch(request, env, ctx));
	},
};
