import { trpc } from "~/lib";
import { z } from "zod";
import { useZodParams } from "~/lib/useZodParams";
import { createNotFoundRedirect } from "~/lib/utils";

export function useDeviceId() {
	const params = useZodParams({ deviceId: z.string() });
	return () => params.deviceId;
}

export function useDevice() {
	const deviceId = useDeviceId();

	const query = trpc.device.get.createQuery(() => ({
		deviceId: deviceId(),
	}));

	createNotFoundRedirect({
		query: query,
		toast: "Device not found",
		to: "../../devices",
	});

	return query;
}
