import { Schema } from "effect";
import { isPlistArray, isPlistObject, plistBoolean, plistText } from "./internal/plistValue.js";
import type { PlistInput, PlistObject } from "./internal/plistValue.js";

/**
 * `UserList` command-result parsing.
 *
 * macOS reports local accounts from `UserList`; the payload normally arrives
 * under `QueryResponses`, but protocol shims flatten it onto the response root,
 * so both parents are accepted. Apple does not report administrator status or
 * last-login time, so neither field exists here.
 */

export type AppleLocalAccount = {
  readonly username: string;
  readonly fullName?: string;
  readonly uid?: number;
  readonly guid?: string;
  /** `HasSecureToken` (macOS 11+). */
  readonly hasSecureToken?: boolean;
  readonly isLoggedIn?: boolean;
  readonly mobileAccount?: boolean;
  /** `DataQuota`; iOS/Shared iPad only, byte count. */
  readonly dataQuota?: number;
  /** `DataUsed`; iOS/Shared iPad only, byte count. */
  readonly dataUsed?: number;
};

const finiteNumber = (value: PlistInput): number | undefined => {
  if (Schema.is(Schema.Number)(value) && Number.isFinite(value)) return value;

  if (Schema.is(Schema.String)(value)) {
    const parsed = Number(value.trim());

    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
};

const integer = (value: PlistInput): number | undefined => {
  const parsed = finiteNumber(value);

  return parsed !== undefined && Number.isInteger(parsed) ? parsed : undefined;
};

/**
 * Read the `UserList` answer. `undefined` means the response was not a user
 * list (so an unrelated command result must not clear the inventory); an empty
 * array is a genuine "no local accounts" report.
 */
export const parseAppleLocalAccounts = (
  queryResponses: PlistInput,
): ReadonlyArray<AppleLocalAccount> | undefined => {
  const container: PlistObject | undefined = isPlistObject(queryResponses)
    ? queryResponses
    : undefined;

  if (!container) return undefined;
  const users = isPlistObject(container.UserList) ? container.UserList.Users : container.Users;

  if (!isPlistArray(users)) return undefined;
  const accounts: AppleLocalAccount[] = [];
  const seen = new Set<string>();

  for (const entry of users) {
    if (!isPlistObject(entry)) continue;
    const username = plistText(entry.UserName);

    if (!username || seen.has(username)) continue;
    seen.add(username);

    const fullName = plistText(entry.FullName);
    const uid = integer(entry.UID);
    const guid = plistText(entry.UserGUID);
    const hasSecureToken = plistBoolean(entry.HasSecureToken);
    const isLoggedIn = plistBoolean(entry.IsLoggedIn);
    const mobileAccount = plistBoolean(entry.MobileAccount);
    const dataQuota = integer(entry.DataQuota);
    const dataUsed = integer(entry.DataUsed);

    accounts.push({
      username,
      ...(fullName ? { fullName } : {}),
      ...(uid === undefined ? {} : { uid }),
      ...(guid ? { guid } : {}),
      ...(hasSecureToken === undefined ? {} : { hasSecureToken }),
      ...(isLoggedIn === undefined ? {} : { isLoggedIn }),
      ...(mobileAccount === undefined ? {} : { mobileAccount }),
      ...(dataQuota === undefined ? {} : { dataQuota }),
      ...(dataUsed === undefined ? {} : { dataUsed }),
    });
  }

  return accounts;
};
