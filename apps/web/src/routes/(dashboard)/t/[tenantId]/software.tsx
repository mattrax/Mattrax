import { useNavigate, useParams } from "@solidjs/router";
import { onSettled } from "solid-js";

/**
 * Software is now a projection of device inventory inside a dashboard. Keep
 * the old URL working for bookmarks without keeping a separate navigation
 * destination.
 */
export default function SoftwareRedirectPage() {
  const params = useParams();
  const navigate = useNavigate();
  onSettled(() => {
    if (params.tenantId) navigate(`/t/${params.tenantId}/dashboards`, { replace: true });
  });

  return null;
}
