import type { Permission, TenantOnboardingState } from "@mattrax/enterprise-domain/client";
import { routes } from "./routes";

export type OnboardingCan = (permission: Permission) => boolean;

export const ONBOARDING_STEP_KEYS = [
  "group",
  "policy",
  "assignment",
  "device",
  "administrator",
] as const;

export type OnboardingStepKey = (typeof ONBOARDING_STEP_KEYS)[number];

export type OnboardingStep = {
  readonly key: OnboardingStepKey;
  readonly title: string;
  readonly description: string;
  /** The page that lets the reader either do the step or review its result. */
  readonly href: string;
  readonly done: boolean;
  /** The permission required to act on the step; read-only members never see it. */
  readonly permission: Permission;
};

/**
 * Turn the API's aggregate counts into the visible checklist.
 *
 * Steps are filtered by the member's permissions rather than hidden with CSS:
 * a member without groups.write never receives a create-a-group step, so the
 * card does not advertise actions they cannot take. Completion is read from
 * live tenant data, so deleting a group makes its step return to "to do".
 */
export function deriveOnboardingSteps(
  tenantId: string,
  state: TenantOnboardingState,
  can: OnboardingCan,
): OnboardingStep[] {
  const tenant = routes.tenant(tenantId);
  const steps: OnboardingStep[] = [];

  if (can("groups.write"))
    steps.push({
      key: "group",
      title: "Create a group",
      description: "Groups decide which devices a policy reaches.",
      href: state.groups > 0 ? tenant.groups() : tenant.newGroup(),
      done: state.groups > 0,
      permission: "groups.write",
    });

  if (can("policies.write")) {
    steps.push({
      key: "policy",
      title: "Create a policy",
      description: "Start from the catalogue, a template or an empty policy.",
      href: state.policies > 0 ? tenant.policies() : tenant.newPolicy(),
      done: state.policies > 0,
      permission: "policies.write",
    });

    steps.push({
      key: "assignment",
      title: "Assign a policy",
      description: "Assign it to a group, a device or a directory user.",
      href: state.firstPolicyId
        ? tenant.policyAssignments(state.firstPolicyId)
        : tenant.policies(),
      done: state.assignedPolicies > 0,
      permission: "policies.write",
    });
  }

  if (can("enrollment.write"))
    steps.push({
      key: "device",
      title: "Enroll your first device",
      description: "Apple, Windows and Android each have their own enrollment path.",
      href: state.devices > 0 ? tenant.devices() : tenant.settingsTab("enrollment"),
      done: state.devices > 0,
      permission: "enrollment.write",
    });

  if (can("members.write"))
    steps.push({
      key: "administrator",
      title: "Invite a second administrator",
      description: "Do not leave the tenant with a single owner.",
      href: tenant.settingsAdministrators(),
      done: state.administrators > 1 || state.pendingInvitations > 0,
      permission: "members.write",
    });

  return steps;
}

/** True once every step the member can act on is done. */
export const onboardingComplete = (steps: ReadonlyArray<OnboardingStep>): boolean =>
  steps.length > 0 && steps.every((step) => step.done);

/**
 * Whether the overview should render the card at all.
 *
 * An empty step list means the member has none of the relevant write
 * permissions; showing an empty progress card would be noise. The card also
 * disappears on completion, before dismissal is needed.
 */
export const shouldShowOnboarding = (
  state: Pick<TenantOnboardingState, "dismissedAt">,
  steps: ReadonlyArray<OnboardingStep>,
): boolean => steps.length > 0 && state.dismissedAt === null && !onboardingComplete(steps);

/** Number of finished steps, for the card's progress label. */
export const onboardingProgress = (steps: ReadonlyArray<OnboardingStep>) => ({
  done: steps.filter((step) => step.done).length,
  total: steps.length,
});

/**
 * The state after a successful dismissal. Returning a new object keeps the
 * caller's query cache immutable and makes the optimistic update testable
 * without a DOM or a server.
 */
export const markOnboardingDismissed = (
  state: TenantOnboardingState,
  dismissedAt: string,
): TenantOnboardingState => ({ ...state, dismissedAt });
