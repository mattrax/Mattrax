import { SegmentedProgress } from "@mattrax/ui";
import type { PolicyProgressSegment } from "~/lib/policy-delivery";

/** A segmented delivery bar; the shared primitive handles zero totals and the
 * accessible summary. */
export default function PolicyProgressBar(props: {
  segments: ReadonlyArray<PolicyProgressSegment>;
  class?: string;
}) {
  return (
    <div class={props.class}><SegmentedProgress segments={props.segments} label="Policy delivery" /></div>
  );
}
