import type { APIEvent } from "@solidjs/start/server";

export function GET({ request }: APIEvent) {
	const url = new URL(request.url);

	const appru = url.searchParams.get("appru");
	if (!appru) return new Response("Missing appru", { status: 400 });
	return new Response(
		`h3>AzureAD Term Of Service</h3>
<button onClick="acceptBtn()">Accept</button>
<script>
function acceptBtn() {
var urlParams = new URLSearchParams(window.location.search);

if (!urlParams.has('redirect_uri')) {
    alert('Redirect url not found. Did you open this in your broswer?');
} else {
    window.location = urlParams.get('redirect_uri') + "?IsAccepted=true&OpaqueBlob=TODOCustomDataFromAzureAD";
}
}
</script>`,
		{
			headers: {
				"content-type": "text/html",
			},
		},
	);
}
