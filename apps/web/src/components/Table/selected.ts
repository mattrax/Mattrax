import { ReactiveSet } from "@solid-primitives/set";
import { type Accessor, type Setter, createSignal } from "solid-js";

// TODO: I have a feeling the problem is rendering not state updates so we can probs convert this back to a `ReactiveSet`

/// A reactive set that keeps track of selected items.
export class Selected<T = number> {
	#selected: ReactiveSet<T>;
	#allSelected: Accessor<boolean>;
	#setAllSelected: Setter<boolean>;
	#size: Accessor<number>;

	constructor(size: Accessor<number>) {
		const [allSelected, setAllSelected] = createSignal(false);
		this.#selected = new ReactiveSet<T>();
		this.#allSelected = allSelected;
		this.#setAllSelected = setAllSelected;
		this.#size = size;
	}

	isSelected(id: T) {
		return this.#allSelected() || this.#selected.has(id);
	}

	select(id: T) {
		if (this.#allSelected()) return;
		this.#selected.add(id);
	}

	deselect(id: T) {
		if (this.#allSelected()) return;
		this.#selected.delete(id);
	}

	isAllSelected() {
		return (
			this.#size() !== 0 &&
			(this.#allSelected() || this.#size() === this.#selected.size)
		);
	}

	isIndeterminate() {
		return !this.#allSelected() && this.#selected.size > 0;
	}

	selectAll() {
		this.#setAllSelected(true);
		this.#selected.clear();
	}

	clear() {
		this.#setAllSelected(false);
		this.#selected.clear();
	}

	selectedCount() {
		return this.#allSelected() ? this.#size() : this.#selected.size;
	}

	getSelected() {
		return this.#allSelected() ? [] : [...this.#selected];
	}
}
