// Client-side exports

export { env } from "~/env";
export type {
  SessionData,
  GetSessionResult,
  GetSessionResultWithData,
} from "./types";
export type { UserProviderVariant as UserProvider } from "~/db";
export type * from "./trpc";
