import { Hono } from "hono";
import { handle } from "hono/vercel";
import router from "@mattrax/api";

// Configure environment variables properly
// @ts-expect-error
import.meta.env = process.env;

export const config = {
  runtime: "edge",
};

const app = new Hono()
  // .basePath("/api") // TODO
  .all("*", (c) => c.text(c.req.url));

// const app = router;

// Register the handler for Vercel Edge Functions
export const GET = handle(app);
export const POST = GET;
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;

// Expose the app for `@hono/vite-dev-server`
export default app;
