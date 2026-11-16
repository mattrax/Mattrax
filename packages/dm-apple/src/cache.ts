/**
 * Cache policy for MDM asset downloads.
 *
 * An asset URL is signed, bound to one device and expires within the hour; the
 * declaration that references it also carries a SHA-256 of the bytes, so a
 * device can safely reuse a copy while the link is valid. `stale-while-revalidate`
 * lets a device keep the last copy while it refreshes in the background, which
 * matters on a congested network.
 */
export const MDM_ASSET_CACHE_CONTROL = "private, max-age=600, stale-while-revalidate=600";

/**
 * Cache policy for `ProfileURL` downloads.
 *
 * The URL is stable across policy edits, so the bytes at a given URL can change
 * when an administrator edits the profile. Serving a cached copy would apply an
 * old Wi-Fi password or restriction, so the response is stored only to be
 * revalidated (`no-cache`) rather than reused without a request.
 */
export const MDM_PROFILE_CACHE_CONTROL = "private, no-cache";
