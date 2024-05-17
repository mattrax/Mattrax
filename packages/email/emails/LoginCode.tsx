// @jsxImportSource react

// biome-ignore lint: don't remove React
import React from "react";
import {
	Body,
	Container,
	Head,
	Heading,
	Html,
	Text,
} from "@react-email/components";
import { Tailwind } from "@react-email/tailwind";

interface Props {
	code: string;
}

function LoginCodeEmail(props: Props) {
	return (
		<Html>
			<Head />
			<Tailwind>
				<Body className="bg-white my-auto mx-auto font-sans px-2">
					<Container className="border border-solid border-[#eaeaea] rounded my-[40px] mx-auto p-[20px] max-w-[465px] text-center">
						<Heading className="text-black text-[24px] font-normal text-center p-0 my-[30px] mx-0">
							Login to <strong>Mattrax</strong>
						</Heading>
						<Text className="font-mono text-2xl p-4 bg-neutral-200 mx-auto rounded-lg">
							{props.code}
						</Text>
						<Text className="text-black text-[14px] leading-[24px]">
							Paste this code into the login form to continue. <br />
							It is valid for 5 minutes.
						</Text>
					</Container>
				</Body>
			</Tailwind>
		</Html>
	);
}

LoginCodeEmail.PreviewProps = {
	code: "123456",
} as Props;

export default LoginCodeEmail;
