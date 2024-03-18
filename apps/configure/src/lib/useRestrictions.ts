import { createQuery } from "@tanstack/solid-query";

export const useRestrictions = () =>
	createQuery(() => ({
		queryKey: ["schema"],
		queryFn: async () => {
			const res = await import("../schema.json");

			// This shallow clone is required to prevent stuff breaking.
			return { ...res };
		},
	}));
