import { toast } from "~/components/toast";
import type { RaisedFailure } from "~/lib/errors";
import { handleStaleWrite, type StaleWriteOptions } from "~/lib/stale-write";

/**
 * `handleStaleWrite` wired to the dashboard's toast. Pages use this so the
 * 412 message is identical everywhere and never blocks the editor.
 */
export const handleStaleWriteWithToast = (
  error: RaisedFailure | undefined,
  options: Omit<StaleWriteOptions, "notify">,
): boolean => handleStaleWrite(error, { ...options, notify: toast.warning });
