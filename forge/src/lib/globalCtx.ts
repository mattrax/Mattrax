import { createContext, useContext } from "solid-js";

export type PublicSessionData = {
  id: string;
  name: string;
  email: string;
  tenants: Tenant[];
};

export type Tenant = {
  id: string;
  name: string;
}; // TODO: Infer this from backend

type GlobalCtx = {
  activeTenant: Tenant | null; // TODO: Make this required
  setActiveTenant: (tenant: string) => void;
  session: PublicSessionData;
  refetchSession: () => Promise<void>;
};

export const globalCtx = createContext<GlobalCtx>(undefined!);

export const useGlobalCtx = () => {
  const ctx = useContext(globalCtx);
  if (!ctx) throw new Error("Missing 'globalCtx.Provider'");
  return ctx;
};
