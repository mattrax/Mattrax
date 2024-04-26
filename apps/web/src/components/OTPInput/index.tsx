import { lazy } from "solid-js";

// TODO: Rewrite this whole component to SolidJS.
const _ReactOTPInput = lazy(() => import("./react"));

export type Props = {
	name?: string;
	disabled?: boolean;
	onInput?: (value: string) => void;
	onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
	afterRender?: () => void;
};

export const preloadOTPInput = _ReactOTPInput.preload;
export const OTPInput = _ReactOTPInput;
