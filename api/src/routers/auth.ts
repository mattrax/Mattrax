import { Hono } from "hono";

export const router = new Hono();

router.get("/", (c) => c.json("Hello World Auth"));
