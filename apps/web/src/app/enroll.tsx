// import { useLocation, useNavigate, useSearchParams } from "@solidjs/router";
// import { Match, Show, Switch } from "solid-js";

// import {
// 	Button,
// 	Card,
// 	CardContent,
// 	CardDescription,
// 	CardHeader,
// 	Input,
// } from "@mattrax/ui";

// TODO: Autocomplete attributes
// TODO: Use Mattrax colors on this page

export default function Page() {
	// const location = useLocation<{ backUrl?: string }>();
	// const [params] = useSearchParams<{ token?: string; email?: string }>();
	// const navigate = useNavigate();

	// const msDeviceEnrollmentUrl = () => {
	// 	const p = new URLSearchParams();
	// 	p.set("mode", "mdm");
	// 	p.set("servername", "https://enterpriseenrollment.mattrax.app"); // TODO: Get from env
	// 	if (params.email) p.set("username", params.email);
	// 	p.set("accesstoken", params.token ?? "");

	// 	return `ms-device-enrollment:?${p.toString()}`;
	// };

	return (
		<div class="flex-grow flex justify-center items-center">
			<div class="w-full flex flex-col items-center justify-center">
				<div class="sm:mx-auto sm:w-full sm:max-w-md flex items-center justify-center pb-2">
					<h2 class="mt-4 text-center text-4xl font-bold leading-9 tracking-tight text-gray-900">
						Mattrax
					</h2>
				</div>

				<p>TODO: Enroll screen</p>

				{/* <CardDescription>
					Please enter your company email to get started
				</CardDescription> */}
			</div>
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
