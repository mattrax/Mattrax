import type { ComponentProps, JSX } from "solid-js";

export type TableDefinition<T> = {
	columns: Record<string, ColumnDefinition<T>>;
	search?: (t: T, query: string) => number;
	bulkActions?: Record<string, () => JSX.Element>;
	filters?: Record<string, Filter<T>>;
};

export type ColumnDefinition<T> = {
	title: string;
	// Size in parts. Default is 1.
	size?: number;
	// TODO: optional but remove from `orderBy` if not
	sort: (a: T, b: T) => number;
	render: (row: T) => JSX.Element;
};

export type Filter<T> = {
	title: string;
	icon: (props: ComponentProps<"svg">) => JSX.Element;
	options?: Record<string, string>;
} & SelectFilter<T, any>;

type SelectFilter<T, O extends Record<string, string>> = {
	options: O;
	apply: (row: T, selected: (keyof O)[]) => boolean;
};

export function defineTable<T>(def: TableDefinition<T>) {
	return def;
}

export const toOptions = <T extends keyof any>(t: T[]) =>
	Object.fromEntries(t.map((v) => [v, v])) as Record<T, T>;
