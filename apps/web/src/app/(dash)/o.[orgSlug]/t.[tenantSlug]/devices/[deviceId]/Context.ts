import { createContextProvider } from "@solid-primitives/context";
import type { RouterOutput } from "~/api";
import type { trpc } from "~/lib";

export const [DeviceContextProvider, useDevice] = createContextProvider(
  (props: {
    device: NonNullable<RouterOutput["device"]["get"]>;
    query: ReturnType<typeof trpc.device.get.createQuery>;
  }) => Object.assign(() => props.device, { query: props.query }),
  null!,
);
