import { useNavigate } from "@solidjs/router";
import { onSettled } from "solid-js";

/**
 * Legacy global settings route. Tenant settings now live under each
 * tenant (`/t/:id/settings`), and personal settings live at `/account`.
 */
export default function SettingsRedirectPage() {
  const navigate = useNavigate();
  onSettled(() => navigate("/account", { replace: true }));

  return null;
}
