import { isDeclarableAppleConfigurationKind } from "@mattrax/enterprise-domain/client";

/**
 * Device delivery state derived from the data the device page already has.
 *
 * Policies are delivered as DDM declarations whose identifier is
 * `<policyId>:<configuration kind>`. The health endpoint reports the last
 * declaration status, so the Scope tab can say whether each contributing
 * policy has reached the device without another API.
 */
export type PolicyDeliveryState = "delivered" | "pending" | "failed" | "inactive" | "not-tracked";

export type DeclarationStatus = {
  readonly identifier: string;
  readonly valid: string;
  readonly active: boolean;
};

/** Mirrors the declaration identifier used by the Apple management layer. */
export const policyDeclarationIdentifier = (policyId: string, kind: string) =>
  `${policyId}:${kind}`;

export const splitPolicyDeclarationIdentifier = (identifier: string) => {
  const [policyId, ...rest] = identifier.split(":");

  return { policyId: policyId ?? "", kind: rest.join(":") };
};

const declarationState = (declaration: DeclarationStatus | undefined): PolicyDeliveryState => {
  if (!declaration) return "pending";

  if (declaration.valid.trim().toLowerCase() !== "valid") return "failed";

  return declaration.active ? "delivered" : "inactive";
};

/**
 * Aggregate every configuration kind a policy contributes into one state.
 *
 * A failed declaration wins over an inactive or still-pending one because it
 * is the state the operator has to act on. `tracked: false` means the platform
 * does not report DDM declarations at all (Windows, Android).
 */
export const policyDeliveryState = (input: {
  policyId: string;
  kinds: ReadonlyArray<string>;
  declarations: ReadonlyArray<DeclarationStatus> | undefined;
  tracked: boolean;
}): PolicyDeliveryState => {
  if (!input.tracked) return "not-tracked";

  // The lock screen default is an imperative profile, not a declaration.
  // Counting it would leave a policy pending forever even after every
  // declarative kind reached the device.
  const kinds = input.kinds.filter(isDeclarableAppleConfigurationKind);

  if (kinds.length === 0) return "not-tracked";

  if (input.declarations === undefined) return "pending";

  const byIdentifier = new Map(
    input.declarations.map((declaration) => [declaration.identifier, declaration]),
  );

  const states = new Set(
    kinds.map((kind) =>
      declarationState(byIdentifier.get(policyDeclarationIdentifier(input.policyId, kind))),
    ),
  );

  if (states.has("failed")) return "failed";

  if (states.has("inactive")) return "inactive";

  if (states.has("pending")) return "pending";

  return "delivered";
};

export const policyDeliveryLabel = (state: PolicyDeliveryState) => {
  switch (state) {
    case "delivered":
      return "Delivered";
    case "failed":
      return "Delivery failed";
    case "inactive":
      return "Inactive on device";
    case "not-tracked":
      return "Not tracked";
    default:
      return "Pending";
  }
};
