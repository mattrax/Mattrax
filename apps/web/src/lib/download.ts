/**
 * Trigger a browser download for an in-memory blob.
 *
 * The anchor must be connected before clicking, and revoking the object URL in
 * the same task can cancel the download in Chromium (the browser has not read
 * the blob yet). Keep it alive for a moment after the click.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
