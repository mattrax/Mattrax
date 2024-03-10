import { useNavigate } from "@solidjs/router";
import { OscarTriedToDesignAMattraxLogoButFailedPrettyHard } from "~/components/MattraxErrorBoundary";
import { Button } from "~/components/ui";

export default function NotFound() {
	const navigate = useNavigate();
	return (
		<div class="p-4 flex flex-col justify-center items-center">
			<OscarTriedToDesignAMattraxLogoButFailedPrettyHard class="w-60" />
			<h1 class="text-3xl font-bold mb-4">404 Not Found</h1>
			<h2>Oh no, the page you requested was not found</h2>
			<Button onClick={() => navigate("/")} class="mt-4">
				Go Home
			</Button>
		</div>
	);
}
