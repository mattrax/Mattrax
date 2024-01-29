import { Hono } from "hono";

const app = new Hono()
  .get("/testing", (c) => c.json({ hello: "world" }))
  .get("/testing2", (c) => c.json({ what: "is up" }));

export type Schema = typeof app extends Hono<any, infer S> ? S : never;

// TODO: Remove this function. I'm just failing with the Typescript compiler API.
export function testing(): Schema {
  return undefined as any;
}
