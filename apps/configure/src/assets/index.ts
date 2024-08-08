const devices = import.meta.glob<true, "default", string>("./devices/*.png", {
	import: "default",
	eager: true,
});

export function determineDeviceImage() {
	// TODO: Properly implement this logic
	const d = Object.values(devices)[0]!;
	return d;
}
