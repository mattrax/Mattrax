## @mattrax/mysql-planetscale

Implements a `@planetscale/database` server that that uses `mysql2` as the backend.

We can't easily use Drizzle's `mysql2` adapter because its return type is not compatible with the `@planetscale/database` client.

The goal is for `mysql2` to be used in development mode, while `@planetscale/database` is used in production.
