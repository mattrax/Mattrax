/** Enter confirms an IME candidate before it confirms the surrounding UI. */
export const isImeComposing = (event: Pick<KeyboardEvent, "isComposing" | "keyCode">): boolean =>
  event.isComposing || event.keyCode === 229;

/** Custom Enter actions must leave native form/IME submission alone. */
export const isSubmitEnter = (event: KeyboardEvent): boolean =>
  event.key === "Enter" && !isImeComposing(event);
