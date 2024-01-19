import { Device, DeviceConfiguration } from "@microsoft/microsoft-graph-types";
import { authenticatedFetch } from "./auth";

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
    `/deviceManagement/managedDevices/${deviceId}/syncDevice`
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

// TODO: Get IOS policy
// TODO: Create IOS policy
// TODO: Update IOS policy
// TODO: Delete IOS policy
