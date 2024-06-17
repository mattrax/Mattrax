import { generateId } from "lucia";

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
	// biome-ignore lint/complexity/noForEach: <explanation>
	// biome-ignore lint/suspicious/noAssignInExpressions: <explanation>
	keys.forEach((k) => ((obj as any)[k] = undefined));

	return obj;
}

export function randomSlug(str: string) {
	return `${str
		.toLowerCase()
		.replace(/\ /g, "-")
		.replace(/[^a-z0-9-v]/g, "")}-${generateId(4)}`;
}

type UnionToIntersection<U> = (
	U extends any
		? (arg: U) => any
		: never
) extends (arg: infer I) => void
	? I
	: never;

type UnionToTuple<T> = UnionToIntersection<
	T extends any ? (t: T) => T : never
> extends (_: any) => infer W
	? [...UnionToTuple<Exclude<T, W>>, W]
	: [];

export const getObjectKeys = <T extends object>(obj: T) =>
	Object.keys(obj) as UnionToTuple<keyof T>;
