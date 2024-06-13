import { buttonVariants } from "@mattrax/ui/button";
import type { APIEvent } from "@solidjs/start/server";
import clsx from "clsx";
import { renderWithApp } from "~/entry-server";
import { Layout } from "./enroll/util";

// This is opened in the MDM webview during AzureAD enrollment
export async function GET({ request, nativeEvent }: APIEvent) {
	const url = new URL(request.url);
	const redirect_uri = url.searchParams.get("redirect_uri") || "";

	const params = new URLSearchParams();
	params.append("IsAccepted", "true");
	params.append("OpaqueBlob", ".");

	return renderWithApp(() => (
		<Layout>
			<div class="max-w-md flex flex-col items-center space-y-2">
				<p class="text-center">
					By enrolling your device in Mattrax you are giving the following
					permissions to your administrator:
				</p>
				<ul class="list-disc">
					<li>Install software & apply settings</li>
					<li>View installed software and settings</li>
				</ul>
				<div class="flex w-full max-w-sm space-x-2">
					<a
						href={`${redirect_uri}?${params.toString()}`}
						class={clsx(
							buttonVariants({
								variant: "outline",
							}),
							"flex-1",
						)}
					>
						Cancel
					</a>
					<a
						href={`${redirect_uri}?${params.toString()}`}
						class={clsx(buttonVariants({}), "flex-1")}
					>
						Agree
					</a>
				</div>
			</div>
		</Layout>
	));
}
