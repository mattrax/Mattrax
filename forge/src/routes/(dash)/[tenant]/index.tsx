import { useGlobalCtx } from "~/lib/globalCtx";

export default function Page() {
  const ctx = useGlobalCtx();

  return <h1>Tenant: {ctx.activeTenant?.name}</h1>;
}
