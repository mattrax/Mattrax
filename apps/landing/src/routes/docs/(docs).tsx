import { allDocs } from "content-collections";

export default function Page() {
	return (
		<ul>
			{allDocs.map((doc) => (
				<li>
					<a href={`/docs/${doc._meta.path}`}>
						<h3>{doc.title}</h3>
					</a>
				</li>
			))}
		</ul>
	);
}
