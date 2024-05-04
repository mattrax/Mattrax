import { getObjectKeys } from "~/api/utils";
import { trpc } from ".";

export const features = {
	// visual_editor: "Policy Visual Editor",
} as const;

export type Features = keyof typeof features;

export function useFeatures() {
	const me = trpc.auth.me.createQuery();

	const result = {};
	for (const feature of getObjectKeys(features)) {
		Object.defineProperty(result, feature, {
			get() {
				// TODO: Should this suspend or not?
				return me.data?.features?.includes(feature);
			},
		});
	}
	return result as Record<Features, boolean>;
}
