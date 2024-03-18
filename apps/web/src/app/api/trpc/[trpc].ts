import {
	HTTPRequest,
	resolveHTTPResponse,
	getBatchStreamFormatter,
} from "@trpc/server/http";
import {
	type AnyRouter,
	type inferRouterContext,
	TRPCError,
} from "@trpc/server";
import { TRPCErrorResponse } from "@trpc/server/rpc";
import { APIEvent, APIHandler } from "@solidjs/start/server";
import { appendResponseHeader, setResponseHeader, setResponseStatus } from "h3";
import { appRouter, createTRPCContext } from "~/api/trpc";
import { H3Event } from "vinxi/http";

function getPath(args: APIEvent): string | null {
	const p: any = args.params.trpc;
	if (typeof p === "string") {
		return p;
	}
	if (Array.isArray(p)) {
		return p.join("/");
	}
	return null;
}

function notFoundError<TRouter extends AnyRouter>(
	opts: ICreateSolidAPIHandlerOpts<TRouter>,
) {
	const error = opts.router.getErrorShape({
		error: new TRPCError({
			message:
				'Query "trpc" not found - is the file named `[trpc]`.ts or `[...trpc].ts`?',
			code: "INTERNAL_SERVER_ERROR",
		}),
		type: "unknown",
		ctx: undefined,
		path: undefined,
		input: undefined,
	});
	const json: TRPCErrorResponse = {
		id: -1,
		error,
	};
	return new Response(JSON.stringify(json), { status: 500 });
}

type CreateContextFn<TRouter extends AnyRouter> = (
	event: APIEvent,
) => inferRouterContext<TRouter> | Promise<inferRouterContext<TRouter>>;

type ICreateSolidAPIHandlerOpts<TRouter extends AnyRouter> = {
	router: TRouter;
	createContext: CreateContextFn<TRouter>;
	responseMeta?: Parameters<typeof resolveHTTPResponse>[0]["responseMeta"];
};

function createSolidAPIHandler<TRouter extends AnyRouter>(
	opts: ICreateSolidAPIHandlerOpts<TRouter>,
) {
	const handler: APIHandler = async (event) => {
		const e: H3Event = event.nativeEvent;

		const path = getPath(event);
		if (path === null) {
			return notFoundError(opts);
		}
		const url = new URL(event.request.url);
		const req: HTTPRequest = {
			query: url.searchParams,
			method: event.request.method,
			headers: Object.fromEntries(event.request.headers),
			body: await event.request.text(),
		};

		let resolve: (value?: any) => void;
		const promise = new Promise<any>((r) => (resolve = r));

		let isStream = false;
		let controller: ReadableStreamController<any>;
		let encoder: TextEncoder;
		let formatter: ReturnType<typeof getBatchStreamFormatter>;

		const unstable_onChunk: Parameters<
			typeof resolveHTTPResponse
		>[0]["unstable_onChunk"] = ([index, string]) => {
			if (index === -1) resolve(string || null);
			else controller.enqueue(encoder.encode(formatter(index, string)));
		};

		const unstable_onHead: Parameters<
			typeof resolveHTTPResponse
		>[0]["unstable_onHead"] = (head, isStreaming) => {
			for (const [key, value] of Object.entries(head.headers ?? {})) {
				/* istanbul ignore if -- @preserve */
				if (typeof value === "undefined") {
					continue;
				}
				if (typeof value === "string") {
					setResponseHeader(e, key, value);
					continue;
				}
				for (const v of value) {
					appendResponseHeader(e, key, v);
				}
			}

			setResponseStatus(e, head.status);

			if (isStreaming) {
				setResponseHeader(e, "Transfer-Encoding", "chunked");
				setResponseHeader(e, "Vary", "trpc-batch-mode");

				const stream = new ReadableStream({
					start(c) {
						controller = c;
					},
				});

				resolve(stream);

				encoder = new TextEncoder();
				formatter = getBatchStreamFormatter();
				isStream = true;
			}
		};

		resolveHTTPResponse({
			router: opts.router,
			responseMeta: opts.responseMeta,
			req,
			path,
			createContext: () => opts.createContext?.(event),
			unstable_onHead,
			unstable_onChunk,
		})
			.then(() => {
				if (!isStream) return;

				controller.enqueue(encoder.encode(formatter.end()));
				controller.close();
			})
			.catch(() => {
				if (!isStream) return;

				controller.close();
			});

		return promise;
	};
	return {
		GET: handler,
		POST: handler,
	};
}

const handler = createSolidAPIHandler({
	router: appRouter,
	createContext: (event) => createTRPCContext(event.nativeEvent),
});

export const { GET, POST } = handler;
