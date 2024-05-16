import { Context } from "../utils/context";

const TenantContext = Context.create<{ id: string; pk: number }>("tenant");

export const useTenant = TenantContext.use;
export const withTenant = TenantContext.with;
