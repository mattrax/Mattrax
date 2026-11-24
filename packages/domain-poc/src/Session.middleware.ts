import * as RpcMiddleware from "effect/rpc/RpcMiddleware";
import { CurrentActor } from "./CurrentActor.context.ts";
import { Unauthorized } from "./Errors.ts";

/**
 * Authenticates the caller and hands `decide`, view `validate` and query
 * handlers the acting administrator.
 *
 * The server half lives in `host/Session.ts`; the domain only declares the
 * contract, so the same model runs in memory for stories.
 */
export class Session extends RpcMiddleware.Service<Session, { provides: CurrentActor }>()(
  "Enterprise/Session",
  { error: Unauthorized },
) {}
