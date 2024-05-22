"use client";

import { useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { AnimatePresence, motion, useIsPresent } from "framer-motion";

import { Button } from "@/components/Button";
import { useIsInsideMobileNavigation } from "@/components/MobileNavigation";
import { useSectionStore } from "@/components/SectionProvider";
import { Tag } from "@/components/Tag";
import { remToPx } from "@/lib/remToPx";

interface NavGroup {
	title: string;
	links: Array<{
		title: string;
		href: string;
		disabled?: boolean;
	}>;
}

function useInitialValue<T>(value: T, condition = true) {
	const initialValue = useRef(value).current;
	return condition ? initialValue : value;
}

function TopLevelNavItem({
	href,
	children,
}: {
	href: string;
	children: React.ReactNode;
}) {
	return (
		<li className="md:hidden">
			<Link
				href={href}
				className="block py-1 text-sm text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
			>
				{children}
			</Link>
		</li>
	);
}

function NavLink({
	href,
	children,
	tag,
	active = false,
	disabled = false,
	isAnchorLink = false,
}: {
	href: string;
	children: React.ReactNode;
	tag?: string;
	active?: boolean;
	disabled?: boolean;
	isAnchorLink?: boolean;
}) {
	return (
		<Link
			href={href}
			aria-current={active ? "page" : undefined}
			className={clsx(
				"flex justify-between gap-2 py-1 pr-3 text-sm transition",
				isAnchorLink ? "pl-7" : "pl-4",
				disabled
					? "cursor-not-allowed text-zinc-900 dark:text-zinc-400"
					: active
						? "text-zinc-900 dark:text-white"
						: "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white",
			)}
		>
			<span className="truncate">{children}</span>
			{tag && (
				<Tag variant="small" color="zinc">
					{tag}
				</Tag>
			)}
		</Link>
	);
}

function VisibleSectionHighlight({
	group,
	pathname,
}: {
	group: NavGroup;
	pathname: string;
}) {
	const [sections, visibleSections] = useInitialValue(
		[
			useSectionStore((s) => s.sections),
			useSectionStore((s) => s.visibleSections),
		],
		useIsInsideMobileNavigation(),
	);

	const isPresent = useIsPresent();
	const firstVisibleSectionIndex = Math.max(
		0,
		[{ id: "_top" }, ...sections].findIndex(
			(section) => section.id === visibleSections[0],
		),
	);
	const itemHeight = remToPx(2);
	const height = isPresent
		? Math.max(1, visibleSections.length) * itemHeight
		: itemHeight;
	const top =
		group.links.findIndex((link) => link.href === pathname) * itemHeight +
		firstVisibleSectionIndex * itemHeight;

	return (
		<motion.div
			layout
			initial={{ opacity: 0 }}
			animate={{ opacity: 1, transition: { delay: 0.2 } }}
			exit={{ opacity: 0 }}
			className="absolute inset-x-0 top-0 bg-zinc-800/2.5 will-change-transform dark:bg-white/2.5"
			style={{ borderRadius: 8, height, top }}
		/>
	);
}

function ActivePageMarker({
	group,
	pathname,
}: {
	group: NavGroup;
	pathname: string;
}) {
	const itemHeight = remToPx(2);
	const offset = remToPx(0.25);
	const activePageIndex = group.links.findIndex(
		(link) => link.href === pathname,
	);
	const top = offset + activePageIndex * itemHeight;

	return (
		<motion.div
			layout
			className="absolute left-2 h-6 w-px bg-emerald-500"
			initial={{ opacity: 0 }}
			animate={{ opacity: 1, transition: { delay: 0.2 } }}
			exit={{ opacity: 0 }}
			style={{ top }}
		/>
	);
}

function NavigationGroup({
	group,
	className,
}: {
	group: NavGroup;
	className?: string;
}) {
	// If this is the mobile navigation then we always render the initial
	// state, so that the state does not change during the close animation.
	// The state will still update when we re-open (re-render) the navigation.
	const isInsideMobileNavigation = useIsInsideMobileNavigation();
	const [pathname, sections] = useInitialValue(
		[usePathname(), useSectionStore((s) => s.sections)],
		isInsideMobileNavigation,
	);

	const isActiveGroup =
		group.links.findIndex((link) => link.href === pathname) !== -1;

	return (
		<li className={clsx("relative mt-6", className)}>
			<motion.h2
				layout="position"
				className="text-xs font-semibold text-zinc-900 dark:text-white"
			>
				{group.title}
			</motion.h2>
			<div className="relative mt-3 pl-2">
				<AnimatePresence initial={!isInsideMobileNavigation}>
					{isActiveGroup && (
						<VisibleSectionHighlight group={group} pathname={pathname} />
					)}
				</AnimatePresence>
				<motion.div
					layout
					className="absolute inset-y-0 left-2 w-px bg-zinc-900/10 dark:bg-white/5"
				/>
				<AnimatePresence initial={false}>
					{isActiveGroup && (
						<ActivePageMarker group={group} pathname={pathname} />
					)}
				</AnimatePresence>
				<ul className="border-l border-transparent">
					{group.links.map((link) => (
						<motion.li key={link.href} layout="position" className="relative">
							<NavLink
								href={link.href}
								active={link.href === pathname}
								disabled={link.disabled}
							>
								{link.title}
							</NavLink>
							<AnimatePresence mode="popLayout" initial={false}>
								{link.href === pathname && sections.length > 0 && (
									<motion.ul
										role="list"
										initial={{ opacity: 0 }}
										animate={{
											opacity: 1,
											transition: { delay: 0.1 },
										}}
										exit={{
											opacity: 0,
											transition: { duration: 0.15 },
										}}
									>
										{sections.map((section) => (
											<li key={section.id}>
												<NavLink
													href={`${link.href}#${section.id}`}
													tag={section.tag}
													isAnchorLink
												>
													{section.title}
												</NavLink>
											</li>
										))}
									</motion.ul>
								)}
							</AnimatePresence>
						</motion.li>
					))}
				</ul>
			</div>
		</li>
	);
}

export const navigation: Array<NavGroup> = [
	{
		title: "Guides",
		links: [
			{ title: "Introduction", href: "/" },
			{ title: "FAQ", href: "/faq" },
			{ title: "Getting started", href: "/getting-started" },
			{ title: "Self-hosting", href: "/self-hosting" },
			{ title: "Roadmap", href: "/roadmap" },
		],
	},
	{
		title: "Concepts",
		links: [
			{ title: "Tenant / Organisation", href: "/concepts/tenant-org" },
			{ title: "User", href: "/concepts/user" },
			{ title: "Device", href: "/concepts/device" },
			{ title: "Policy", href: "/concepts/policy" },
			{ title: "Applications", href: "/concepts/applications" },
			{ title: "Group", href: "/concepts/group" },
		],
	},
	{
		title: "Components",
		links: [
			{ title: "mttx", href: "/components/mttx" },
			{ title: "mattrax", href: "/components/mattrax" },
			{ title: "mattraxd", href: "/components/mattraxd" },
		],
	},
	{
		title: "Policies",
		links: [
			{ title: "Overview", href: "/policies" },
			{ title: "WiFi", href: "/policies/wifi" },
		],
	},
	// TODO: "Using Mattrax"
	// TODO: - explain concepts, supported device OS versions
	// TODO: "Policies"
	// TODO: - Break out built in policies and common 3rd party ones like Slack, Microsoft Office, etc
	// TODO:    - What OS's do they support, platform differences, user vs device scoping and how they apply.
	{
		title: "REST API",
		links: [
			// { title: 'Getting started', href: '/api' }, // TODO:
			// TODO: Urls for these (I left `/devices` as a reference)
			{ title: "Tenant", href: "#", disabled: true },
			{ title: "Users", href: "#", disabled: true },
			{ title: "Devices", href: "#", disabled: true },
			{ title: "Policies", href: "#", disabled: true },
			{ title: "Applications", href: "#", disabled: true },
		],
	},
];

export function Navigation(props: React.ComponentPropsWithoutRef<"nav">) {
	return (
		<nav {...props}>
			<ul >
				<TopLevelNavItem href="/">API</TopLevelNavItem>
				<TopLevelNavItem href="#">Documentation</TopLevelNavItem>
				<TopLevelNavItem href="#">Support</TopLevelNavItem>
				{navigation.map((group, groupIndex) => (
					<NavigationGroup
						key={group.title}
						group={group}
						className={groupIndex === 0 ? "md:mt-0" : ""}
					/>
				))}
				<li className="sticky bottom-0 z-10 mt-6 min-[416px]:hidden">
					<Button href="#" variant="filled" className="w-full">
						Sign in
					</Button>
				</li>
			</ul>
		</nav>
	);
}
