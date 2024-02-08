import { MDMBackend, intuneMdmBackend, simpleMdmBackend } from "@mattrax/mdm";
import { env } from "./env";

const simpleMdm = simpleMdmBackend(env.SIMPLEMDM_API_KEY);
const intuneMdm = intuneMdmBackend(
  env.INTUNE_CLIENT_ID,
  env.INTUNE_CLIENT_SECRET,
  env.INTUNE_TENANT
);

export function getMdm(): MDMBackend {
  // TODO: Match on the device type and return correct backend
  return simpleMdm;
}
