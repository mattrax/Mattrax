/**
 * The six-digit code input shared by sign-up and the standalone verification
 * screen. Both pages own the copy and the error around it; keeping the field
 * itself in one place stops the numeric/one-time-code behaviour drifting apart.
 */
export function EmailCodeField(props: {
  value: string;
  onInput: (value: string) => void;
  invalid?: boolean;
  /** Id of the element that explains a failure. */
  describedBy?: string;
  inputRef?: (input: HTMLInputElement) => void;
}) {
  return (
    <div class="space-y-1.5">
      <label for="verification-code" class="text-sm font-medium text-stone-700">
        Verification code
      </label>
      <input
        id="verification-code"
        ref={props.inputRef}
        type="text"
        inputmode="numeric"
        autocomplete="one-time-code"
        pattern="[0-9]{6}"
        maxlength="6"
        required
        placeholder="000000"
        aria-invalid={props.invalid ? "true" : undefined}
        aria-describedby={props.describedBy}
        value={props.value}
        onInput={(event) =>
          props.onInput(event.currentTarget.value.replaceAll(/\D/g, "").slice(0, 6))
        }
        class="w-full rounded-lg border border-input bg-card px-3 py-2.5 text-center text-2xl tracking-[0.4em] text-foreground placeholder:tracking-[0.4em] placeholder:text-muted-foreground/60 outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 transition-colors"
      />
    </div>
  );
}
