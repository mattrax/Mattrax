import { Domain } from "./domain.ts";
import { Actor } from "./Actor.ts";

/** The authenticated administrator, provided by the Session middleware. */
export class CurrentActor extends Domain.RequestContext<CurrentActor>()(
  "Enterprise/CurrentActor",
  Actor,
) {}
