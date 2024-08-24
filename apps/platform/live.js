// TODO: A workaround for: https://github.com/sst/ion/issues/909

import { execSync } from "node:child_process";
import path from "node:path";

execSync("cargo watch -x 'run --bin lambda'", {
	stdio: "inherit",
	shell: "/bin/zsh",
	cwd: path.join(process.cwd(), ".."),
	env: {
		...process.env,
		// RUSTFLAGS: "-Awarnings", // TODO: Merge in user's RUSTFLAGS -> Don't do this cause it means rebuilding everything
		CARGO_TERM_COLOR: "always",
		AWS_LAMBDA_FUNCTION_MEMORY_SIZE: "1024",
		AWS_LAMBDA_RUNTIME_API: `http://${process.env.AWS_LAMBDA_RUNTIME_API}`,
	},
});

// By stalling here we block SST's Lambda runtime from starting up, letting Rust's take over.
while (true) {
	await new Promise((resolve) => setTimeout(resolve, 10000));
}
