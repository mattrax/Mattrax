import { createContextProvider } from "@solid-primitives/context";
import { RouterOutput } from "~/api";
import { trpc } from "~/lib";

export const [DeviceContextProvider, useDevice] = createContextProvider(
	(props: {
		device: NonNullable<RouterOutput["device"]["get"]>;
		query: ReturnType<typeof trpc.device.get.useQuery>;
	}) => Object.assign(() => props.device, { query: props.query }),
	null!,
);
