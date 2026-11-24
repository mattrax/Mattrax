import { Effect, Layer, Option, Schema } from "effect";
import { Actor } from "../Actor.ts";
import { CurrentActor } from "../CurrentActor.context.ts";
import { Unauthorized } from "../Errors.ts";
import { Session } from "../Session.middleware.ts";

/**
 * The server half of the Session middleware.
 *
 * In this POC the actor travels in an `x-actor` header (URL-encoded JSON) or a
 * `poc-actor` cookie, so a browser can switch identity without a sign-in flow
 * and an EventSource can carry the same identity. In the real port this Layer
 * asks the existing session/token code who the caller is — the domain never
 * learns how.
 */
const ActorJson = Schema.fromJsonString(Actor);

export const actorFromHeaders = (
  headers: Readonly<Record<string, string | undefined>>,
): Option.Option<Actor> => {
  const header = headers["x-actor"];
  const cookie = headers["cookie"];
  const cookieValue = cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("poc-actor="))
    ?.slice("poc-actor=".length);

  const raw = header ?? cookieValue;
  if (!raw) return Option.none();

  try {
    return Schema.decodeUnknownOption(ActorJson)(decodeURIComponent(raw));
  } catch {
    return Option.none();
  }
};

export const SessionLive = Layer.succeed(Session, (effect, { headers }) =>
  Option.match(actorFromHeaders(headers), {
    onNone: () => Effect.fail(new Unauthorized()),
    onSome: (actor) => Effect.provideService(effect, CurrentActor, actor),
  }),
);
