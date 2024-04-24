/** @jsx h */

function h(...args: any[]) {
	return React.createElement(...args);
}

import {
	Body,
	Container,
	Head,
	Heading,
	Html,
	Preview,
	Text,
} from "@react-email/components";
import { Tailwind } from "@react-email/tailwind";
import React, { JSX } from "react";

interface Props {
	tenantName: string;
}

export function UserEnrollmentInvite(props: Props) {
	const previewText = `Join ${props.tenantName} on Mattrax`;

	return (
		<Html>
			<Head />
			<Preview>{previewText}</Preview>
			<Tailwind>
				<Body className="bg-white my-auto mx-auto font-sans px-2">
					<Container className="border border-solid border-[#eaeaea] rounded my-[40px] mx-auto p-[20px] max-w-[465px]">
						<Heading className="text-black text-[24px] font-normal text-center p-0 my-[30px] mx-0">
							Join <strong>{props.tenantName}</strong> on{" "}
							<strong>Mattrax</strong>
						</Heading>
						<Text className="text-black text-[14px] leading-[24px]">
							You've been invited to join <strong>{props.tenantName}</strong> on{" "}
							<strong>Mattrax</strong>
							Follow these instructions to enroll your device.
						</Text>
					</Container>
				</Body>
			</Tailwind>
		</Html>
	);
}

UserEnrollmentInvite.PreviewProps = {
	tenantName: "Enigma",
} as Props;

export default UserEnrollmentInvite;
