/**
 * MySQL's `aws-ssl-profiles` bundle carries every AWS RDS CA. Mattrax connects
 * to a Hyperdrive/DigitalOcean endpoint with an explicit `ssl` object and never
 * selects the `"Amazon RDS"` profile, so the ~174 KB table has no runtime use.
 */
export const ca: string[] = [];

export const proxies: string[] = [];

export default { ca, proxies };
