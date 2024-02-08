import { MDMBackend } from "./backend";
import { initGraphClient } from "@mattrax/ms-graph";

export const intuneMdmBackend = (
  clientId: string,
  clientSecret: string,
  tenantId: string
): MDMBackend => {
  const client = initGraphClient(tenantId, clientId, clientSecret);

  return {
    async getEnrollmentProfile(tenantId, userId) {
      throw new Error("TODO");
    },
    async pushPolicy() {
      throw new Error("TODO");
    },
  };
};
