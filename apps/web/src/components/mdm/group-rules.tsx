import { DeviceQueryBuilder } from "~/components/dashboard/query-builder";
import type { DynamicGroupRules } from "~/lib/enterprise";

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
  const query = () =>
    props.rules
      ? {
          version: 1 as const,
          ...(props.rules.all ? { all: props.rules.all } : {}),
          ...(props.rules.any ? { any: props.rules.any } : {}),
          ...(props.rules.none ? { none: props.rules.none } : {}),
        }
      : null;

  return (
    <DeviceQueryBuilder
      query={query()}
      disabled={props.disabled}
      onChange={(next) =>
        props.onChange({
          version: 1,
          ...(next?.all ? { all: next.all } : {}),
          ...(next?.any ? { any: next.any } : {}),
          ...(next?.none ? { none: next.none } : {}),
        })
      }
    />
  );
}
