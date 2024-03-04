// @ts-check

const fs = require("fs");
const path = require("path");

const readdirSync = (p, a = []) => {
	if (fs.statSync(p).isDirectory())
		fs.readdirSync(p).map((f) =>
			readdirSync(a[a.push(path.join(p, f)) - 1], a),
		);
	return a;
};

const tsFilesForPath = (pathname) =>
	readdirSync(path.resolve(__dirname, pathname)).filter(
		(f) => f.endsWith(".ts") || f.endsWith(".tsx"),
	);

const ADDED_STR = "// @ts-nocheck\n\n";
const FILES = [
	// ...tsFilesForPath("../apps/landing/node_modules/@solidjs/start"),
];

Promise.allSettled(FILES.map(addTsNoCheck)).then((results) => {
	let hasErrors = false;

	for (const result of results) {
		if (result.status === "rejected") {
			hasErrors = true;
			console.error(result.reason);
		}
	}

	if (hasErrors) {
		process.exit(1);
	}
});

async function addTsNoCheck(fileRelative) {
	const file = path.resolve(__dirname, fileRelative);
	const content = fs.readFileSync(file).toString();

	if (content.includes(ADDED_STR)) {
		console.log(JSON.stringify(ADDED_STR), "is already in", file);
	} else {
		fs.writeFileSync(file, ADDED_STR + content);
		console.log(JSON.stringify(ADDED_STR), "added into", file);
	}
}
