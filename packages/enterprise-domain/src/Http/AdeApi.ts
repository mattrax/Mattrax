import { HttpApiEndpoint } from "effect/http-api";
import { HttpApiGroup } from "effect/http-api";
import { AppleEnrollmentProfileResponse } from "../Enrollment.js";
import { EnterprisePublicAdeProfileErrors } from "../Errors.js";

export const enterpriseAdeApi = HttpApiGroup.make("EnterpriseAde")
  .add(
    HttpApiEndpoint.post("enrollAdeDevice", "/v1/abm/ade/enroll", {
      error: EnterprisePublicAdeProfileErrors,
      success: AppleEnrollmentProfileResponse,
    }),
  )
  .prefix("/api");

/**
 * Attribute registry, device attribute values and enrollment questions.
 *
 * Kept in its own top-level group, like scripts, so the generated browser
 * contract stays manageable: the main group already carries nearly two hundred
 * endpoints and the declaration emitter refuses to serialise one more layer.
 */
