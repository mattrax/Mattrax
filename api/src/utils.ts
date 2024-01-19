import { GetSessionResult } from "../../forge/src/server/session";
import { Hono, type MiddlewareHandler } from "hono";
// @ts-expect-error: No types :(
import { int_to_base58, base58_to_int } from "base58";

export type HonoType = { Bindings: { session: GetSessionResult } };

export const newApp = () => new Hono<HonoType>();

export const withAuth: MiddlewareHandler<HonoType> = async (c, next) => {
  if (c.env.session.data?.id === undefined) {
    c.status(401);
    return c.json({ error: "Unauthenticated" });
  }

  await next();
};

// TODO: Should we encrypt them???
// TODO: This isn't actually hiding the numbers cause they are valid base58
export const encodeId = (prefix: string, id: number): string =>
  prefix ? `${prefix}_${int_to_base58(id)}` : int_to_base58(id);

// TODO: Should we encrypt them???
// TODO: This isn't actually hiding the numbers cause they are valid base58
export const decodeId = (prefix: string, id: string): number => {
  const parts = id.split("_");
  if (parts.length !== 2) throw new Error(`Invalid ID: ${id}`);
  if (parts[0] !== prefix) throw new Error(`Invalid ID: ${id}`);
  return base58_to_int(parts[1]);
};
