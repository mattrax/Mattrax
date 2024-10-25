import type { APIEvent } from "@solidjs/start/server";

export function GET({ request }: APIEvent) {
	const url = new URL(request.url);
	const appru = url.searchParams.get("appru");

	// TODO: Style this error page
	if (!appru) return new Response("Missing appru", { status: 400 });

	return new Response(
		`<form method="post" action="${appru}">
	    <p><input type="hidden" name="wresult" value="TODOSpecialTokenWhichVerifiesAuth" /></p>
	    <input type="submit" value="Login" />
	    </form>`,
		{
			headers: {
				"Content-Type": "text/html",
			},
		},
	);
}
