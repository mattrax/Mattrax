import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";

export const appleMdmApi = HttpApiGroup.make("MattraxAppleMDM")
  .add(
      HttpApiEndpoint.post("checkin", "/", {}),
    )
  .prefix("/mdm/apple");
