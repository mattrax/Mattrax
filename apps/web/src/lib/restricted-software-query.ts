export const deviceRestrictedSoftwareQueryEnabled = (access: {
  readonly canRead: boolean;
  readonly overview: boolean;
  readonly hasDevice: boolean;
}): boolean => access.canRead && access.overview && access.hasDevice;
