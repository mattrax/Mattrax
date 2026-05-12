import { useNavigate, useParams } from "@solidjs/router";
import { createEffect } from "solid-js";

export default function TenantIndexPage() {
  const params = useParams();
  const navigate = useNavigate();

  createEffect(() => {
    navigate(`/t/${params.tenantId}/devices`, { replace: true });
  });

  return null;
}
