// Request flow:
// - Matches `frontendRoutes` `index.html` will be served by the `_redirects` file
// - Matches apiRoutes the Worker will be invoked by the `_routes.json` `include` pattern
// - Otherwise, static files or `404.html` will be served by the CDN

// All frontend routes.
// These need a redirect to automatically serve the HTML from the edge, as the Worker has smart placement (so it's not from the edge).
// TODO: Automatically generate from file system router information?
export const frontendRoutes = ["/", "/t/*", "/account", "/roadmap"];

// All backend routes
// These go to the Worker.
export const apiRoutes = [
	"/api/*",
	"/EnrollmentServer/*",
	"/ManagementServer/*",
];

// Headers to apply to all routes.
// TODO: Right now these don't allow to routes served by the Worker (but they should)
export const headers = {
	"/*": {
		"X-Frame-Options": "DENY",
		"X-Content-Type-Options": "nosniff",
		"Referrer-Policy": "strict-origin-when-cross-origin",
		"Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
	},
	"/favicon.ico": {
		"Cache-Control":
			"public, max-age=1440, s-maxage=1440, stale-if-error=1440, no-transform",
	},
	"/_build/*": {
		"Cache-Control": "public, immutable, max-age=31536000",
	},
	"/_server/*": {
		"Cache-Control": "public, immutable, max-age=31536000",
	},
	...Object.fromEntries(
		frontendRoutes.map((route) => [
			route,
			{
				"Cache-Control":
					"public, max-age=0, s-maxage=3600, stale-if-error=3600, no-transform",
			},
		]),
	),
};
