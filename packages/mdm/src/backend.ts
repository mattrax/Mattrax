export type MDMBackend = {
  getEnrollmentProfile: (tenantId: number, userId: number) => Promise<string>;
  pushPolicy: (profile: string) => Promise<void>;
};
