import { DeviceQueryBuilder } from "~/components/dashboard/query-builder";
import type { DeviceQuery, DynamicGroupRules } from "~/lib/enterprise";

/**
 * Dynamic groups use the same query language and builder as dashboards and
 * device-table filters. The only difference is the persisted wrapper shape
 * (`{ version: 1, all/any/none }` on the group row).
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
