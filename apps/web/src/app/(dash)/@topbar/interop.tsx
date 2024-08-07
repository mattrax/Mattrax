// This file hacks support for parallel routes back into the current stable Solid Start/Solid Router version.
// For: https://github.com/solidjs/solid-router/pull/426

import { makeEventListener } from "@solid-primitives/event-listener";
import {
	type RouteDefinition,
	Router,
	useLocation,
	useNavigate,
} from "@solidjs/router";
import { type ParentProps, createEffect, lazy } from "solid-js";

const breadcrumbs = [
	{
		component: lazy(() => import("./@breadcrumbs")),
		children: [
			{
				path: "/o/:orgSlug",
				component: lazy(() => import("./@breadcrumbs/o.[orgSlug]")),
				children: [
					{
						path: "/t/:tenantSlug",
						component: lazy(
							() => import("./@breadcrumbs/o.[orgSlug]/t.[tenantSlug]"),
						),
						children: [
							{
								path: "/apps/:appId/*rest",
								component: lazy(
									() =>
										import(
											"./@breadcrumbs/o.[orgSlug]/t.[tenantSlug]/apps.[appId].[...rest]"
										),
								),
							},
							{
								path: "/devices/:deviceId/*rest",
								component: lazy(
									() =>
										import(
											"./@breadcrumbs/o.[orgSlug]/t.[tenantSlug]/devices.[deviceId].[...rest]"
										),
								),
							},
							{
								path: "/groups/:groupId/*rest",
								component: lazy(
									() =>
										import(
											"./@breadcrumbs/o.[orgSlug]/t.[tenantSlug]/groups.[groupId].[...rest]"
										),
								),
							},
							{
								path: "/policies/:policyId/*rest",
								component: lazy(
									() =>
										import(
											"./@breadcrumbs/o.[orgSlug]/t.[tenantSlug]/policies.[policyId].[...rest]"
										),
								),
							},
							{
								path: "/*rest",
								component: lazy(
									() =>
										import(
											"./@breadcrumbs/o.[orgSlug]/t.[tenantSlug]/[...rest]"
										),
								),
							},
						],
					},
				],
			},
			{
				path: "/settings/*rest",
				component: lazy(() => import("./@breadcrumbs/settings.[...rest]")),
			},
		],
	},
	{
		path: "/*rest",
		component: () => null,
	},
] satisfies RouteDefinition[];

const navitems = [
	{
		component: lazy(() => import("./@navItems")),
		children: [
			{
				path: "/o/:orgSlug",
				children: [
					{
						path: "/t/:tenantSlug",
						children: [
							// {
							// 	path: "/apps/:appId/*rest",
							// 	component: lazy(
							// 		() =>
							// 			import(
							// 				"./@navItems/o.[orgSlug]/t.[tenantSlug]/apps.[appId].[...rest]"
							// 			),
							// 	),
							// },
							{
								path: "/devices/:deviceId/*rest",
								component: lazy(
									() =>
										import(
											"./@navItems/o.[orgSlug]/t.[tenantSlug]/devices.[deviceId].[...rest]"
										),
								),
							},
							{
								path: "/groups/:groupId/*rest",
								component: lazy(
									() =>
										import(
											"./@navItems/o.[orgSlug]/t.[tenantSlug]/groups.[groupId].[...rest]"
										),
								),
							},
							{
								path: "/policies/:policyId/*rest",
								component: lazy(
									() =>
										import(
											"./@navItems/o.[orgSlug]/t.[tenantSlug]/policies.[policyId].[...rest]"
										),
								),
							},
							{
								path: "/*rest",
								component: lazy(
									() =>
										import("./@navItems/o.[orgSlug]/t.[tenantSlug]/[...rest]"),
								),
							},
						],
					},
					{
						path: "/*rest",
						component: lazy(() => import("./@navItems/o.[orgSlug]/[...rest]")),
					},
				],
			},
		],
	},
	{
		path: "/*rest",
		component: () => null,
	},
] satisfies RouteDefinition[];

export function NavItemsSlot() {
	const location = useLocation();

	createEffect(() => {
		location.pathname;
		document.dispatchEvent(
			new CustomEvent("mttx-location", { detail: location.pathname }),
		);
	});

	return <Router root={RouterSyncRoot}>{navitems}</Router>;
}

export function BreadcrumbsSlot() {
	const location = useLocation();

	createEffect(() => {
		location.pathname;
		document.dispatchEvent(
			new CustomEvent("mttx-location", { detail: location.pathname }),
		);
	});

	return <Router root={RouterSyncRoot}>{breadcrumbs}</Router>;
}

function RouterSyncRoot(props: ParentProps) {
	const navigate = useNavigate();
	makeEventListener(document, "mttx-location", (e) => {
		const url = (e as any).detail;
		navigate(url);
	});

	return props.children;
}
