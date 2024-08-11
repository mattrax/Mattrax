import type { ButtonProps } from "@mattrax/ui";
import type { JSX } from "solid-js";
import type { Database } from "~/lib/db";

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
	load: (db: Database) => Promise<T[]>;
	columns: ColumnDefinitions<T>;
	filters: FilterDefinitions<T>;
	actions: ActionDefinitions<T>;
};

export type ColumnDefinitions<T> = Record<
	// Used to uniquely identify the semantic meaning of the column.
	// These will be merged across entities using the first `header` that is discovered.
	// The render function will still be called on the specific entity to ensure links and the like remain correct.
	string,
	{
		// The header to display above the column.
		header: JSX.Element;
		// The size of the column in `px`.
		size?: "auto" | number;
		// The content to render in the individual table cell.
		render: (data: T) => JSX.Element;
		// Render to raw data. Used for csv and json exporting.
		raw: (data: T) => string;
	}
>;

export type ActionDefinitions<T> = Record<
	// Used to uniquely identify the semantic meaning of the column.
	// These will be merged across entities using the first `title` that is discovered.
	// The apply function will still be called on the specific entity to ensure links and the like remain correct.
	string,
	{
		// The title of the action.
		title: string;
		// Button variant
		variant?: ButtonProps["variant"];
		// The function to run when the action is applied.
		apply: (data: T[]) => Promise<void>;
	}
>;

export type FilterDefinitions<T> = Record<
	// Used to uniquely identify the semantic meaning of the column.
	// These will be merged across entities using the first `title`/`icon` that is discovered.
	string,
	{
		title: string;
		icon?: JSX.Element;

		// TODO: Define filters apply filters
	}
>;
