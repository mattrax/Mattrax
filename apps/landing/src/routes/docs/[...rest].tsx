import { Navigate, useParams } from "@solidjs/router";
import { allDocs } from "content-collections";

export default function Page() {
	const params = useParams();

	// TODO: Can we make this work with static analysis so that we don't need the `content` of all pages loaded for hydration????
	const doc = allDocs.find((d) => d._meta.path === params.rest);
	if (!doc) return <Navigate href="/docs" />;

	// TODO: Render `content` as HTML

	return (
		<ul>
			<h3>{doc.title}</h3>
			<div>{doc.content}</div>
		</ul>
	);
}
