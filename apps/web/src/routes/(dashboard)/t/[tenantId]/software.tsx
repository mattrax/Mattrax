import { useParams } from "@solidjs/router";
import { useNavigate } from "~/lib/navigation";
import { onSettled } from "solid-js";

/**
 * Software moved into the application catalogue and per-device inventory.
 * Keep the old URL working for bookmarks by forwarding to the applications
 * list; the curated catalogue is one tab away.
 */
export default function SoftwareRedirectPage() {
  const params = useParams();
  const navigate = useNavigate();
  onSettled(() => {
    if (params.tenantId) navigate(`/t/${params.tenantId}/applications`, { replace: true });
  });

  return (
    <div class="flex flex-1 items-center justify-center py-24">
      <p class="text-[12px] text-muted-foreground">Opening applications…</p>
    </div>
  );
}
