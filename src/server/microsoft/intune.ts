import { Device } from "@microsoft/microsoft-graph-types";
import { authenticatedFetch } from "./auth";

export const getDevices = () =>
  authenticatedFetch<Device>("/deviceManagement/managedDevices");

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
    `/deviceManagement/managedDevices/${deviceId}/syncDevice`
  );

// TODO: Unenroll device

// TODO: Get IOS policy
// TODO: Create IOS policy
// TODO: Update IOS policy
// TODO: Delete IOS policy
