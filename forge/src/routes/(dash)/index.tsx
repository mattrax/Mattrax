import { useAuthContext } from "../(dash)";

import { Navigate } from "@solidjs/router";

export default function Page() {
  const auth = useAuthContext();

  // If we have an active tenant, send the user to it
  if (auth.me.tenants[0]) {
    return <Navigate href={auth.me.tenants[0].id} />;
  }

  return (
    <h1 class="p-4">No tenant selected. Please create one to get started!</h1>
  );
}
