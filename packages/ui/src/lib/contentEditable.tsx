// const moveCursorToEnd = (elem: HTMLElement) => {
// 	const range = document.createRange();
// 	const selection = window.getSelection()!;
// 	range.setStart(elem, elem.childNodes.length);
// 	range.collapse(true);
// 	selection.removeAllRanges();
// 	selection.addRange(range);
// };

export function createContentEditableController(onInput: (e: string) => void) {
	// const [editable, setEditable] = createSignal(false);

	return () => ({
		contenteditable: true, // editable(),
		tabindex: 0,
		// onFocus: (e) => {
		// 	setEditable(true);
		// 	// e.currentTarget.focus();
		// 	moveCursorToEnd(e.currentTarget);
		// },
		// onMouseDown: () => {
		// 	setEditable(true);
		// },
		onKeyDown: (
			e: KeyboardEvent & {
				currentTarget: HTMLElement;
			},
		) => {
			// Prevent having multiple lines
			if (e.key === "Enter") {
				e.preventDefault();
				e.currentTarget.blur();
			}
		},
		onFocusOut: (
			e: FocusEvent & {
				currentTarget: {
					textContent: string | null;
				};
			},
		) => {
			if (e.currentTarget.textContent) onInput(e.currentTarget.textContent);
		},
	});
}
