/**
 * Whether another device may enroll for a tenant.
 *
 * `maxDevices === 0` means unlimited (the enrollment settings UI advertises
 * this), and a finite cap uses a strict comparison so the configured maximum is
 * the number of devices allowed, not one fewer.
 */
export const canEnrollDevice = (deviceCount: number, maxDevices: number) =>
  maxDevices === 0 || deviceCount < maxDevices;
