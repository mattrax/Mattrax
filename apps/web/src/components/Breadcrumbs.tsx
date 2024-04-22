/* @refresh skip */

import { useMatch, useMatches } from "@solidjs/router";
import {
  type Component,
  Index,
  type ParentProps,
  Suspense,
  createMemo,
} from "solid-js";
import { Dynamic } from "solid-js/web";

export function Breadcrumbs() {
  const matches = useMatches();

  const breadcrumbs = createMemo(() =>
    matches().flatMap((match) => {
      const Inner:
        | {
            Component: Component<{ href: string }>;
            hasNestedSegments?: boolean;
          }
        | undefined = match.route.info?.BREADCRUMB;
      return Inner ? [{ ...Inner, match }] : [];
    }),
  );

  return (
    <div class="flex flex-row items-center text-sm font-medium space-x-2 text-gray-800">
      <Index each={breadcrumbs()}>
        {(b) => {
          const _match = useMatch(
            () => `${b().match.path}/:segment/:subSegment/*`,
          );

          const href = createMemo(() => {
            const __match = b().hasNestedSegments ? _match() : undefined;

            const ret = __match
              ? `${b().match.path}/${__match.params.segment}`
              : b().match.path;

            return ret;
          });

          return (
            <Breadcrumb>
              <Dynamic component={b().Component} href={href()} />
            </Breadcrumb>
          );
        }}
      </Index>
    </div>
  );
}

export function Breadcrumb(props: ParentProps) {
  return (
    <Suspense>
      <div class="flex flex-row items-center gap-2">
        <IconMdiSlashForward class="text-lg text-gray-300" />
        {props.children}
      </div>
    </Suspense>
  );
}
