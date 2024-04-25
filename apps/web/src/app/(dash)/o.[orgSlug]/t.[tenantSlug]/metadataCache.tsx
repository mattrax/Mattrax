import { ReactiveMap } from "@solid-primitives/map";
import { createEffect } from "solid-js";

const MetadataMap = ReactiveMap<string, { name: string }>;

export const metadata = {
	application: new MetadataMap(),
	device: new MetadataMap(),
	group: new MetadataMap(),
	policy: new MetadataMap(),
	user: new MetadataMap(),
};

export function cacheMetadata<TVariant extends keyof typeof metadata>(
	variant: TVariant,
	data: () => Array<{ id: string; name: string }>,
) {
	createEffect(() => {
		const map = metadata[variant];

		data().forEach((item) => {
			map.set(item.id, { name: item.name });
		});
	});
}

export function getMetadata<TVariant extends keyof typeof metadata>(
	variant: TVariant,
	id: string,
) {
	return metadata[variant].get(id);
}
