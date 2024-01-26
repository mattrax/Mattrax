import { newAuthedApp } from "../utils";
import mockUserData from "./users.json";

export const app = newAuthedApp().get("/", async (c) => {
  // TODO: Pagination abstraction

  const offset = parseInt(c.req.query("offset")!);
  const limit = parseInt(c.req.query("limit")!);
  // TODO: Constrain offset and limit to specific max/min values

  // TODO: Can a cursor make this more efficent???

  // .slice(offset, offset + limit) // TODO

  return c.json(mockUserData);
});
