import { useLocation, useNavigate, useSearchParams } from "@solidjs/router";
import { Match, Show, Switch } from "solid-js";
import {
	Button,
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	Input,
} from "~/components/ui";

// TODO: Autocomplete attributes
// TODO: Use Mattrax colors on this page

export default function Page() {
	const location = useLocation<{ backUrl?: string }>();
	const [params] = useSearchParams<{ token?: string; email?: string }>();
	const navigate = useNavigate();

	const msDeviceEnrollmentUrl = () => {
		const p = new URLSearchParams();
		p.set("mode", "mdm");
		p.set("servername", "https://enterpriseenrollment.mattrax.app"); // TODO: Get from env
		if (params.email) p.set("username", params.email);
		p.set("accesstoken", params.token ?? "");

		return `ms-device-enrollment:?${p.toString()}`;
	};

	return (
		<div class="h-full flex flex-row justify-center p-4">
			<Card class="max-w-md min-h-0 w-full self-center">
				<CardHeader>
					<div class="sm:mx-auto sm:w-full sm:max-w-md flex items-center justify-center">
						<h2 class="mt-4 text-center text-2xl font-bold leading-9 tracking-tight text-gray-900">
							Mattrax
						</h2>
					</div>

					<CardDescription class="text-center">
						To enroll your device, enter your email address:
					</CardDescription>
				</CardHeader>

				<CardContent>
					<Switch
						fallback={
							<>
								<form
									action="/api/enrollment/login"
									method="get"
									class="space-y-4"
								>
									<Input
										type="email"
										name="email"
										placeholder="user@example.com"
										autocomplete="email"
									/>

									<Button type="submit" class="w-full">
										<span class="text-sm font-semibold leading-6">Enroll</span>
									</Button>
								</form>
								<div class="flex justify-center">
									<Show when={location.state?.backUrl}>
										{(backUrl) => (
											<Button
												variant="link"
												onClick={() => navigate(backUrl())}
											>
												Go Back
											</Button>
										)}
									</Show>
								</div>
							</>
						}
					>
						<Match when={params?.token}>
							{/* // TODO: Set the description different */}
							{/* // TODO: Detect OS and customise */}

							<div class="flex justify-center">
								{/* Hide this when not on Windows */}
								<a href={msDeviceEnrollmentUrl()}>Enroll Windows</a>

								{/* // TODO: Apple flow */}

								{/* // TODO: Android flow */}
							</div>
						</Match>
					</Switch>
				</CardContent>
			</Card>
		</div>
	);
}

// function download(content: Uint8Array, type: string, filename: string) {
//   const a = document.createElement("a");
//   const blob = new Blob([content], {
//     type: "application/octet-stream",
//   });
//   a.href = window.URL.createObjectURL(blob);
//   a.download = filename;
//   a.click();
// }

// // The implementation of this function was taken from Intune's minified code
// // It's required for the code signing data to not get corrupted
// function base64Decode(encoded: string) {
//   for (
//     var n = window.atob(encoded), r = n.length, o = new Uint8Array(r), i = 0;
//     i < r;
//     i++
//   )
//     o[i] = n.charCodeAt(i);
//   return o;
// }
