import { useNavigate } from "@solidjs/router";
import { useQuery } from "@tanstack/solid-query";
import { createEffect } from "solid-js";
import { PageHeader } from "~/components/mdm/common";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";

export default function DashboardPage() {
  const navigate = useNavigate();
  const me = useQuery(() => ({ queryKey: enterpriseKeys.me(), queryFn: enterprise.me }));

  createEffect(() => {
    if (me.isSuccess) {
      const tenant = me.data.activeTenant ?? me.data.tenants[0];
      navigate(tenant ? `/t/${tenant.id}/devices` : "/tenants/new", { replace: true });
    }
  });

  return (
    <div class="flex flex-1 flex-col gap-6 p-6">
      <PageHeader title="Dashboard" description="Loading your active tenant..." />
    </div>
  );
}
