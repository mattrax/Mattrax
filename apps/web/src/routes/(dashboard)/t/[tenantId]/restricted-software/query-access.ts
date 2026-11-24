export type RestrictedSoftwareQueryAccess = {
  readonly read: boolean;
  readonly write: boolean;
  readonly isNew: boolean;
  readonly violationsView: boolean;
};

export type RestrictedSoftwareQueryFlags = {
  readonly rules: boolean;
  readonly violations: boolean;
  readonly detail: boolean;
  readonly targets: boolean;
};

export const restrictedSoftwareQueryAccess = (
  access: RestrictedSoftwareQueryAccess,
): RestrictedSoftwareQueryFlags => ({
  rules: access.read,
  violations: access.read && access.violationsView,
  detail: access.read && !access.isNew,
  // The target endpoint loads the tenant's complete device and group lists.
  // It is only useful while composing or editing scope.
  targets: access.read && access.write,
});
