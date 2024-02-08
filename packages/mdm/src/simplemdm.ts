import { MDMBackend } from "./backend";

export const simpleMdmBackend = (apiKey: string): MDMBackend => {
  const baseUrl = `https://a.simplemdm.com/api/v1`;
  return {
    async getEnrollmentProfile(tenantId, userId) {
      throw new Error("TODO");
    },
    async pushPolicy(profile: string) {
      // TODO: Create or update the profile

      const formData = new FormData();
      formData.append("name", "Testing");
      formData.append(
        "mobileconfig",
        new File([profile], "profile.mobileconfig")
      );
      // TODO: user_scope: false,

      const resp = await fetch(`${baseUrl}/custom_configuration_profiles`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(apiKey + ":")}`,
        },
        body: formData,
      });
      if (!resp.ok)
        throw new Error(
          `Failed to push profile: ${resp.status} ${resp.statusText}`
        );
      const data = await resp.json(); // TODO: Zod validation

      console.log(data);
    },
  };
};
