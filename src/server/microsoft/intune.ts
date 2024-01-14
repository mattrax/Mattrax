import { Device } from "@microsoft/microsoft-graph-types";
import { authenticatedFetch } from "./auth";

export const getDevices = () =>
  authenticatedFetch<Device>("/deviceManagement/managedDevices");
