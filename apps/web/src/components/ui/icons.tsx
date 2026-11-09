import type { JSX } from "solid-js";

type IconProps = JSX.SvgSVGAttributes<SVGSVGElement>;

function Icon(props: IconProps & { children: JSX.Element }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      {...props}
    />
  );
}

export function Boxes(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m7.5 4.3 4.5 2.6 4.5-2.6" />
      <path d="M3 8.5 12 14l9-5.5" />
      <path d="M12 14v8" />
      <path d="m3 8.5 9-5.2 9 5.2v10.4L12 24 3 18.9z" />
    </Icon>
  );
}

export function Building2(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18" />
      <path d="M6 12H4a2 2 0 0 0-2 2v8" />
      <path d="M18 9h2a2 2 0 0 1 2 2v11" />
      <path d="M10 6h4" />
      <path d="M10 10h4" />
      <path d="M10 14h4" />
      <path d="M10 18h4" />
    </Icon>
  );
}

export function CheckCircle2(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </Icon>
  );
}

export function Check(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m20 6-11 11-5-5" />
    </Icon>
  );
}

export function ChevronRight(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m9 18 6-6-6-6" />
    </Icon>
  );
}

export function ChevronsUpDown(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m7 15 5 5 5-5" />
      <path d="m7 9 5-5 5 5" />
    </Icon>
  );
}

export function CircleAlert(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </Icon>
  );
}

export function Ellipsis(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </Icon>
  );
}

export function Laptop(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9" />
      <path d="M2 20h20" />
      <path d="M6 16h12" />
    </Icon>
  );
}

export function LayoutDashboard(props: IconProps) {
  return (
    <Icon {...props}>
      <rect width="7" height="9" x="3" y="3" rx="1" />
      <rect width="7" height="5" x="14" y="3" rx="1" />
      <rect width="7" height="9" x="14" y="12" rx="1" />
      <rect width="7" height="5" x="3" y="16" rx="1" />
    </Icon>
  );
}

export function LinkIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1" />
      <path d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20.1l1.1-1.1" />
    </Icon>
  );
}

export function LogOut(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </Icon>
  );
}

export function MonitorSmartphone(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M18 8V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8" />
      <path d="M8 20h4" />
      <path d="M10 16v4" />
      <rect width="6" height="10" x="16" y="12" rx="2" />
    </Icon>
  );
}

export function Menu(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 12h16" />
      <path d="M4 6h16" />
      <path d="M4 18h16" />
    </Icon>
  );
}

export function Plus(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </Icon>
  );
}

export function Settings(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12.2 2h-.4l-1 3a7.5 7.5 0 0 0-1.7.7l-2.8-1.4-.3.3-2 3.5.2.4 2.5 1.9a7.5 7.5 0 0 0 0 1.8l-2.5 1.9-.2.4 2 3.5.3.3 2.8-1.4a7.5 7.5 0 0 0 1.7.7l1 3h.4l4-.7.3-.3.3-3.1a7.5 7.5 0 0 0 1.4-1l3 .7.3-.3 1.4-3.8-.1-.4-2.9-1.3a7.5 7.5 0 0 0-.3-1.8l2.1-2.4v-.4l-2.6-3.1-.4-.1-2.6 1.8a7.5 7.5 0 0 0-1.6-.4L12.2 2Z" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  );
}

export function ShieldCheck(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 13c0 5-3.5 7.5-7.7 8.9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.5a1.3 1.3 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="m9 12 2 2 4-4" />
    </Icon>
  );
}

export function Smartphone(props: IconProps) {
  return (
    <Icon {...props}>
      <rect width="14" height="20" x="5" y="2" rx="2" />
      <path d="M12 18h.01" />
    </Icon>
  );
}

export function TabletSmartphone(props: IconProps) {
  return (
    <Icon {...props}>
      <rect width="10" height="14" x="3" y="8" rx="2" />
      <path d="M8 18h.01" />
      <rect width="10" height="14" x="11" y="2" rx="2" />
      <path d="M16 12h.01" />
    </Icon>
  );
}

export function User(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M19 21a7 7 0 0 0-14 0" />
      <circle cx="12" cy="7" r="4" />
    </Icon>
  );
}

export function UsersRound(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M18 21a8 8 0 0 0-16 0" />
      <circle cx="10" cy="8" r="5" />
      <path d="M22 20c0-3.4-2-6.3-5-7.5" />
      <path d="M17 3.1a5 5 0 0 1 0 9.8" />
    </Icon>
  );
}

export function X(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Icon>
  );
}
