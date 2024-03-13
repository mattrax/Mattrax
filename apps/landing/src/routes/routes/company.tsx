import type { JSX } from "solid-js";

export default function Page() {
	return (
		<main>
			<div class="mt-32 sm:mt-56">
				<div class="mx-auto max-w-7xl px-6 lg:px-8">
					<div class="mx-auto max-w-3xl sm:text-center">
						<p class="mt-2 text-3xl font-bold tracking-tight text-gray-900 sm:text-7xl">
							Mattrax Technologies
						</p>
						<p class="mt-6 text-xl leading-8 text-gray-600">
							We at Mattrax Technologies are setting out to build better tools
							for IT administrators. <br /> Empowering smaller teams to move
							faster and more reliably than was ever possible.
						</p>

						<h5 class="pt-8 text-2xl font-semibold leading-7 text-center">
							Team
						</h5>

						<div class="mt-6 flex justify-center items-center text-start">
							<div class="space-y-4 flex flex-col sm:w-full sm:flex-row sm:justify-around">
								<div class="flex">
									<img
										class="w-16 h-16 rounded-full"
										src="https://gravatar.com/avatar/41655c1232c6dd52cdeac8d01beb25502c52b270a46d9e8c6c487261775d0a48?size=512"
										alt="Oscar Beaumont"
									/>
									<div class="flex flex-col justify-start ml-3">
										<h5 class="text-lg font-semibold text-gray-900">
											Oscar Beaumont
										</h5>
										<a
											class="mt-1 text-base text-gray-500"
											href="mailto:oscar@mattrax.app"
										>
											oscar@mattrax.app
										</a>
										<p class="mt-1 text-base text-gray-600">Co-founder</p>
									</div>
								</div>

								<div class="flex">
									<img
										class="w-16 h-16 rounded-full"
										src="https://gravatar.com/avatar/8dcfb438d50edbc0133b55391e0f43d77c4249021a46777fa15a1be16d7bdda3?size=512"
										alt="Brendan Allan"
									/>
									<div class="flex flex-col justify-start ml-3">
										<h5 class="text-lg font-semibold text-gray-900">
											Brendan Allan
										</h5>
										<a
											class="mt-1 text-base text-gray-500"
											href="mailto:brendan@mattrax.app"
										>
											brendan@mattrax.app
										</a>
										<p class="mt-1 text-base text-gray-600">Co-founder</p>
									</div>
								</div>
							</div>
						</div>

						<p class="mt-6 text-lg leading-8 text-gray-600">
							Feel free to reach out to{" "}
							<a
								href="mailto:hello@mattrax.app"
								class="underline underline-offset-2"
							>
								hello@mattrax.app
							</a>
						</p>
					</div>
				</div>
			</div>
		</main>
	);
}
