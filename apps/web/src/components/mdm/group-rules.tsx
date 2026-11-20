import { DeviceQueryBuilder } from "~/components/dashboard/query-builder";
import type { DeviceQuery, DynamicGroupRules } from "~/lib/enterprise";

/**
 * Dynamic groups use the same query language and builder as dashboards and
 * device-table filters. Differences:
 *
 * - the persisted wrapper shape (`{ version: 1, all/any/none }` on the group row);
 * - conditions on linked directory people (`userEmail`, `userDomain`,
 *   `userName`, `userExternalId`, `userSource`) are offered here because only
 *   group evaluation loads `device_user` links.
 *
 * Person conditions are existential: a positive condition matches when any
 * linked user matches, `is not` matches when no linked user matches, and a
 * device with no linked user fails every positive person condition. A device's
 * disabled (leaver) users are ignored.
 */
export function GroupRuleBuilder(props: {
  rules: DynamicGroupRules | null | undefined;
  onChange: (rules: DynamicGroupRules) => void;
  disabled?: boolean;
}) {
  const query = (): DeviceQuery | null =>
    props.rules
      ? {
          version: 1,
          all: props.rules.all,
          any: props.rules.any,
          none: props.rules.none,
        }
      : null;

  return (
    <DeviceQueryBuilder
      query={query()}
      disabled={props.disabled}
      includeUserConditions
      onChange={(next) =>
        props.onChange({
          version: 1,
          all: next?.all,
          any: next?.any,
          none: next?.none,
        })
      }
    />
  );
}
