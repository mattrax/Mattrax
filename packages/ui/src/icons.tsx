import type { JSX } from "@solidjs/web";
import { cn } from "./lib/cn";

type SvgProps = JSX.SvgSVGAttributes<SVGSVGElement>;

function Icon(props: SvgProps & { children: JSX.Element }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class={cn("size-4", props.class)}
      {...props}
    />
  );
}

/** A small, consistent icon set for the design system. */
export function X(props: SvgProps) {
  return (
    <Icon {...props}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Icon>
  );
}

export function Check(props: SvgProps) {
  return (
    <Icon {...props}>
      <path d="M20 6 9 17l-5-5" />
    </Icon>
  );
}

export function ChevronDown(props: SvgProps) {
  return (
    <Icon {...props}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  );
}

export function ChevronRight(props: SvgProps) {
  return (
    <Icon {...props}>
      <path d="m9 18 6-6-6-6" />
    </Icon>
  );
}

export function ChevronsUpDown(props: SvgProps) {
  return (
    <Icon {...props}>
      <path d="m7 15 5 5 5-5" />
      <path d="m7 9 5-5 5 5" />
    </Icon>
  );
}

export function Plus(props: SvgProps) {
  return (
    <Icon {...props}>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </Icon>
  );
}

export function Search(props: SvgProps) {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </Icon>
  );
}

export function ArrowRight(props: SvgProps) {
  return (
    <Icon {...props}>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </Icon>
  );
}

export function TriangleAlert(props: SvgProps) {
  return (
    <Icon {...props}>
      <path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </Icon>
  );
}

export function CircleCheck(props: SvgProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </Icon>
  );
}

export function Info(props: SvgProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </Icon>
  );
}

export function Eye(props: SvgProps) {
  return (
    <Icon {...props}>
      <path d="M2.1 12.3a1 1 0 0 1 0-.6 10.7 10.7 0 0 1 19.8 0 1 1 0 0 1 0 .6 10.7 10.7 0 0 1-19.8 0" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  );
}

export function EyeOff(props: SvgProps) {
  return (
    <Icon {...props}>
      <path d="M10.7 5.1A10.7 10.7 0 0 1 21.9 12a10.7 10.7 0 0 1-2.2 3.2" />
      <path d="M6.6 6.6A10.7 10.7 0 0 0 2.1 12a10.7 10.7 0 0 0 15.3 5.4" />
      <path d="M2 2l20 20" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </Icon>
  );
}

