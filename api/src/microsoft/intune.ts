import {
  Device,
  DeviceConfiguration,
  IosCustomConfiguration,
} from "@microsoft/microsoft-graph-types";
import { authenticatedFetch, authenticatedFetchBeta } from "./auth";
import { db, kvStore } from "../db";
import { eq } from "drizzle-orm";
import { franksScopes } from "../routes/internal";
import { env } from "../env";

export const getDevices = () =>
  authenticatedFetch<{
    "@odata.count": number;
    value: Device[];
  }>("/deviceManagement/managedDevices");

export const getDevice = (id: string) =>
  authenticatedFetch<Device>(
    `/deviceManagement/managedDevices/${encodeURIComponent(id)}`
  );

export const getApplications = (deviceId: string) =>
  authenticatedFetch<void>(`/deviceManagement/mobileApps`);

// TODO: Create application

// TODO: Delete application

export const rebootDevice = (deviceId: string) =>
  authenticatedFetch<void>(
    `/deviceManagement/managedDevices/${deviceId}/rebootNow`
  );

export const shutdownDevice = (deviceId: string) =>
  authenticatedFetch<void>(
    `/deviceManagement/managedDevices/${deviceId}/shutDown`
  );

export const syncDevice = (deviceId: string) =>
  authenticatedFetch<void>(
    `/deviceManagement/managedDevices/${deviceId}/syncDevice`,
    {
      method: "POST",
    }
  );

// TODO: Unenroll device

export const getDeviceConfigurations = () =>
  authenticatedFetch<{
    "@odata.count": number;
    value: DeviceConfiguration[];
  }>(`/deviceManagement/deviceConfigurations`);

export const getDeviceConfiguration = (id: string) =>
  authenticatedFetch<DeviceConfiguration>(
    `/deviceManagement/deviceConfigurations/${encodeURIComponent(id)}`
  );

// TODO: The input to this can be an enum of many possible types???
export const createDeviceConfiguration = (policy: IosCustomConfiguration) =>
  authenticatedFetch<unknown>(`/deviceManagement/deviceConfigurations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(policy),
  });

// TODO: The input to this can be an enum of many possible types???
export const updateDeviceConfiguration = (
  id: string,
  policy: IosCustomConfiguration
) =>
  authenticatedFetch<unknown>(
    `/deviceManagement/deviceConfigurations/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(policy),
    }
  );

export const assignDeviceConfiguration = (
  id: string,
  data: any // TODO: Typescript
) =>
  authenticatedFetch<unknown>(
    `/deviceManagement/deviceConfigurations/${encodeURIComponent(id)}/assign`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
      skipBodyParse: true,
    }
  );

// This is what the Intune dashboard uses.
// I double checked and no `depOnboardingSettings` are returned from the list query.
const depOnboardingSettingId = "0449db8b-e7a4-42f2-a547-1c1cfaff21c5";

export const createEnrollmentProfile = (name: string, description?: string) =>
  authenticatedFetchBeta<{
    id: string;
    // TODO: Proper type
  }>(
    `/deviceManagement/depOnboardingSettings/${depOnboardingSettingId}/enrollmentProfiles`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        "@odata.context": `https://graph.microsoft.com/beta/$metadata#deviceManagement/depOnboardingSettings('${depOnboardingSettingId}')/enrollmentProfiles/$entity`,
        displayName: name,
        description: description,
      }),
    }
  );

export const getEnrollmentProfile = (id: string) =>
  authenticatedFetchBeta<{
    id: string;
    displayName: string;
    description: string;
    // TODO: Proper type
  }>(
    `/deviceManagement/depOnboardingSettings/${depOnboardingSettingId}/enrollmentProfiles/${id}`
  );

// Frank is the bot account
export const getFrankAccessToken = async () => {
  const refreshToken = (
    await db
      .select()
      .from(kvStore)
      .where(eq(kvStore.key, "intune_refresh_token"))
  )?.[0]?.value;
  if (!refreshToken) throw new Error("No refresh token found for Frank");

  const reqBody = new URLSearchParams();
  reqBody.set("client_id", env.MSFT_CLIENT_ID!);
  reqBody.set("scope", franksScopes);
  reqBody.set("refresh_token", refreshToken);
  reqBody.set("grant_type", "refresh_token");
  reqBody.set("client_secret", env.MSFT_CLIENT_SECRET!);

  const resp = await fetch(
    `https://login.microsoftonline.com/${env.MSFT_ADMIN_TENANT!}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: reqBody,
    }
  );
  if (!resp.ok) throw new Error(`Failed to get access token from Microsoft`);

  const body: {
    token_type: string;
    scope: string;
    expires_in: number;
    ext_expires_in: number;
    access_token: string;
    refresh_token: string;
  } = await resp.json();

  // TODO: Is the fact that a new refresh token comes back going to cause race conditions???
  await db
    .insert(kvStore)
    .values({
      key: "intune_refresh_token",
      value: body.refresh_token,
    })
    .onDuplicateKeyUpdate({
      set: {
        value: body.refresh_token,
      },
    });

  return body;
};

export const exportEnrollmentProfile = async (id: string) =>
  authenticatedFetchBeta<{
    value: string;
  }>(
    `/deviceManagement/depOnboardingSettings/${depOnboardingSettingId}/enrollmentProfiles/${id}/exportMobileConfig`,
    {
      headers: {
        // TODO: Microsoft lied, people died
        // TODO: This endpoint doesn't seem to support an application token.
        Authorization: `Bearer ${(await getFrankAccessToken()).access_token}`,
      },
    }
  );
