import { useNavigate, useParams } from "@solidjs/router";
import { onSettled } from "solid-js";

/** Kept as a stable shortcut: enrollment now lives under tenant settings. */
export default function EnrollmentRedirectPage() {
  const params = useParams();
  const navigate = useNavigate();
  onSettled(() => {
    if (params.tenantId) navigate(`/t/${params.tenantId}/settings/enrollment`, { replace: true });
  });
  return null;
}
