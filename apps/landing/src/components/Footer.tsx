import linethree from "../assets/linethree.svg";

const linkStyle =
	"text-zinc-600 font-medium hover:text-blue-400 transition-all duration-300";

const Footer = () => {
	return (
		<footer class="flex flex-col w-full max-w-[1000px] items-center py-5">
			<div
				class="w-full h-10 w-full"
				style={{
					"background-image": `url(${linethree})`,
					"background-size": "contain",
					"background-repeat": "no-repeat",
				}}
			/>
			<div class="flex flex-col sm:flex-row gap-10 items-center sm:items-start w-full justify-between mt-10">
				<p class="text-zinc-400">
					Developed by{" "}
					<a href="/company" class={linkStyle} rel="external">
						Mattrax Inc.
					</a>
					<span class="px-1">on</span>
					<a
						href="https://github.com/mattrax/Mattrax"
						class={linkStyle}
						rel="noreferrer external"
						target="_blank"
					>
						GitHub
					</a>
				</p>
				<p class="text-zinc-400">
					Site designed by{" "}
					<a
						href="https://www.aashhab.design"
						class={linkStyle}
						rel="noreferrer external"
						target="_blank"
					>
						Ameer Al Ashhab
					</a>
				</p>
			</div>
		</footer>
	);
};

export default Footer;
