import { newApp } from "../utils";
import mockUserData from "./users.json";

export const app = newApp().get("/", async (c) => {
  // TODO: Full-text search???

  // TODO: Pagination abstraction

  const offset = parseInt(c.req.query("offset")!);
  const limit = parseInt(c.req.query("limit")!);
  // TODO: Constrain offset and limit to specific max/min values

  // TODO: Can a cursor make this more efficent???

  // .slice(offset, offset + limit) // TODO

  // TODO: Remove this
  // await new Promise((r) => setTimeout(r, 1000));

  // TODO: Switch to DB

  return c.json(mockUserData);
});
