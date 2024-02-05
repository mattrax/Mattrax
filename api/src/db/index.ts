// import { drizzle } from "drizzle-orm/planetscale-serverless";
// import { connect } from "@planetscale/database";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";

import { env } from "../env";

export * from "./schema";
import * as schema from "./schema";

// const connection = connect({
//   url: env.DATABASE_URL,
// });

const connection = mysql.createPool({
  uri: env.DATABASE_URL,
});

export const db = drizzle(connection, { schema, mode: "default" });
