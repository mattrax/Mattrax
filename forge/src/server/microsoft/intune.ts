import {
  Device,
  DeviceConfiguration,
  IosCustomConfiguration,
} from "@microsoft/microsoft-graph-types";
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
