import { buttonVariants } from "@mattrax/ui/button";
import type { APIEvent } from "@solidjs/start/server";
import clsx from "clsx";
import { Show } from "solid-js";
import { renderWithApp } from "~/entry-server";
import { Layout } from "./enroll/util";

// This is opened in the MDM webview during AzureAD enrollment
export async function GET({ request, nativeEvent }: APIEvent) {
	const url = new URL(request.url);

	// Set by MDM webview
	const redirect_uri = url.searchParams.get("redirect_uri") || "";
	const mode = url.searchParams.get("mode") || "";

	// > Users skip the Terms of Use when they're adding a Microsoft work account to their device. However, they can't skip it during the Microsoft Entra join process.
	// https://learn.microsoft.com/en-us/windows/client-management/azure-active-directory-integration-with-mdm
	const isEntraAdJoinMode = mode === "azureadjoin";

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
					<Show when={!isEntraAdJoinMode}>
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
					</Show>
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
