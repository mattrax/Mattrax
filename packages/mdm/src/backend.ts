export type MDMBackend = {
	getEnrollmentProfile: (tenantPk: number, userId: number) => Promise<string>;
	pushPolicy: (profile: string) => Promise<void>;
};
