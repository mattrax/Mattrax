import type { JSX } from "solid-js";

// TODO: Rest of the possibilities + clean this up
export type Filter =
	| {
			type: "string";
			op: "eq";
			// field: string[]; // TODO: Can we typesafe this?
			value: string;
	  }
	| {
			type: "enum";
			target: "type"; // TODO: This should be more dynamic cause it's not a filter thing???
			// TODO: `op: "contains"`???
			value: string; // TODO: Allow multiple values
	  };

export function defineEntity<T>(entity: Entity<T>) {
	return entity;
}

export type Entity<T> = {
	load: () => Promise<T[]>;
	columns: ColumnDefinitions<T>;
};

export type ColumnDefinitions<T> = Record<
	// Used to uniquely identify the semantic meaning of the column.
	// These will be merged across entities using the first `header` that is discovered.
	// The render function will still be called on the specific entity to ensure links and the like remain correct.
	string,
	{
		header: JSX.Element;
		render: (data: T) => JSX.Element;
	}
>;
