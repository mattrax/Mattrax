export type PromiseValues<TO> = {
	[TK in keyof TO]: Promise<TO[TK]>;
};

export const promiseAllObject = <T>(obj: PromiseValues<T>): Promise<T> => {
	return Promise.all(
		Object.entries(obj).map(async ([k, v]) => [k, await v]),
	).then(Object.fromEntries);
};

export function getEmailDomain(email: string) {
	const segments = email.split("@");
	return segments[segments.length - 1]!;
}

export function omit<T, K extends string>(obj: T, keys: K[]): Omit<T, K> {
	keys.forEach((k) => ((obj as any)[k] = undefined));

	return obj;
}
