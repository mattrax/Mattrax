export default function Page() {
	return (
		<main class="light text-black">
			<div class="mt-32 sm:mt-56">
				<div class="mx-auto max-w-7xl px-6 lg:px-8">
					<div class="mx-auto max-w-4xl sm:text-center">
						<p class="mt-2 text-3xl font-bold tracking-tight text-gray-900 sm:text-7xl">
							Mattrax Inc.
						</p>
						<p class="mt-6 text-xl leading-8 text-gray-600">
							<span class="inline-block">
								We at Mattrax are setting out to build better tools for IT
								administrators.
							</span>
							<span class="inline-block">
								Empowering smaller teams to move faster without compromising on
								end-user experience.
							</span>
						</p>

						<h5 class="pt-8 text-2xl font-semibold leading-7 text-center">
							Team
						</h5>

						<div class="mt-6 flex justify-center items-center text-start">
							<div class="flex flex-col sm:w-full sm:flex-row sm:justify-around space-y-4 sm:space-y-0">
								<div class="flex">
									<img
										class="w-16 h-16 rounded-full"
										src="https://github.com/oscartbeaumont.png"
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
										<p class="mt-1 text-base text-gray-600 font-bold">
											Founder
										</p>
									</div>
								</div>

								<div class="flex">
									<img
										class="w-16 h-16 rounded-full"
										src="https://github.com/brendonovich.png"
										alt="Brendan Allan"
									/>
									<div class="flex flex-col justify-start ml-3">
										<h5 class="text-lg font-semibold text-gray-900">
											Brendan Allan
										</h5>
										<p class="mt-1 text-base text-gray-600">Developer</p>
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
