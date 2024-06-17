import ctaart from "../assets/ctaart.svg";
import LandingButton from "./LandingButton";

const Cta = () => {
	return (
		<div class="px-5">
			<div
				style={{
					"background-image": `url(${ctaart})`,
					"background-size": "contain",
					"background-repeat": "no-repeat",
					"background-position": "bottom",
				}}
				class="bg-white p-5 max-w-[1000px] mx-auto my-[100px] bento-shadow rounded-lg h-[400px] border border-zinc-200 w-full flex items-center justify-center flex-col gap-5"
			>
				<p class="w-full max-w-[380px] text-center text-[24px] font-medium">
					Join the <span class="text-blue-500">community</span> to keep up with{" "}
					<span class="text-blue-500">development progress</span> and chat with
					us.
				</p>
				<a
					href="https://discord.gg/WPBHmDSfAn"
					target="_blank"
					rel="noreferrer"
				>
					<LandingButton>
						<IconFaBrandsDiscord />
						Discord
					</LandingButton>
				</a>
			</div>
		</div>
	);
};

export default Cta;
