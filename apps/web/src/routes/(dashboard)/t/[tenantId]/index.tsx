import { useNavigate, useParams } from "@solidjs/router";
import { createEffect } from "solid-js";

export default function TenantIndexPage() {
  const params = useParams();
  const navigate = useNavigate();

  createEffect(
    () => params.tenantId,
    (tenantId) => {
      navigate(`/t/${tenantId}/devices`, { replace: true });
    },
  );

  return null;
}
