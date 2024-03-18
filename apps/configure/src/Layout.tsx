import { startTransition, type ParentProps } from "solid-js";
import { A, useNavigate } from "@solidjs/router";

import { path, setPath } from "./file";
import mttxLogo from "./assets/MATTRAX.png";

export default function Layout(props: ParentProps) {
	return (
		<>
			<Navbar />
			{props.children}
		</>
	);
}

function Navbar() {
	const navigate = useNavigate();

	return (
		<div class="flex flex-col gap-4 bg-gray-100 py-2">
			<nav class="flex w-40 flex-col items-stretch space-y-1">
				<div class="p-2 space-y-2 flex flex-col">
					<button
						type="button"
						onClick={() => {
							setPath(null);
							startTransition(() => navigate("/"));
						}}
					>
						<img src={mttxLogo} alt="Logo" class="h-5 mx-auto" />
					</button>
					{path()?.split("/").at(-1)}
				</div>
				{/* TODO: Visually indicate they are disabled */}
				<NavbarItem href="edit" disabled={path() === null}>
					Overview
				</NavbarItem>
				<NavbarItem href="edit/network" disabled={path() === null}>
					Network
				</NavbarItem>
				<NavbarItem href="edit/restrictions" disabled={path() === null}>
					Restrictions
				</NavbarItem>
			</nav>
		</div>
	);
}

function NavbarItem(props: ParentProps & { href: string; disabled?: boolean }) {
	return (
		<A
			href={props.href}
			class="w-full cursor-pointer border-b-2 border-t-2 p-2 hover:bg-gray-200/50"
			classList={{
				"pointer-events-none cursor-default": props.disabled,
			}}
		>
			{props.children}
		</A>
	);
}
