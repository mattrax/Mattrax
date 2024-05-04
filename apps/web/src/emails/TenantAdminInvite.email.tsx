// @ts-nocheck // TODO: Typescript
/** @jsx React.createElement */

// biome-ignore lint: don't remove React
import React from "react";
import {
	Body,
	Button,
	Container,
	Head,
	Heading,
	Html,
	Link,
	Preview,
	Section,
	Text,
} from "@react-email/components";
import { Tailwind } from "@react-email/tailwind";

interface Props {
	invitedByEmail: string;
	tenantName: string;
	inviteLink: string;
}

export function TenantAdminInvite(props: Props) {
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
						{/* <Text className="text-black text-[14px] leading-[24px]">
              Hello {username},
            </Text> */}
						<Text className="text-black text-[14px] leading-[24px]">
							{/* <strong>{invitedByUsername}</strong> ( */}
							<Link
								href={`mailto:${props.invitedByEmail}`}
								className="text-blue-600 no-underline"
							>
								{props.invitedByEmail}
							</Link>
							{/* )  */} has invited you to the{" "}
							<strong>{props.tenantName}</strong> tenant on{" "}
							<strong>Mattrax</strong>.
						</Text>
						{/* <Section>
              <Row>
                <Column align="right">
                  <Img
                    className="rounded-full"
                    src={userImage}
                    width="64"
                    height="64"
                  />
                </Column>
                <Column align="center">
                  <Img
                    src={`${baseUrl}/static/vercel-arrow.png`}
                    width="12"
                    height="9"
                    alt="invited you to"
                  />
                </Column>
                <Column align="left">
                  <Img
                    className="rounded-full"
                    src={teamImage}
                    width="64"
                    height="64"
                  />
                </Column>
              </Row>
            </Section> */}
						<Section className="text-center mt-[32px] mb-[32px]">
							<Button
								className="bg-[#000000] rounded text-white text-[12px] font-semibold no-underline text-center px-5 py-3"
								href={props.inviteLink}
							>
								Join the tenant
							</Button>
						</Section>
						<Text className="text-black text-[14px] leading-[24px]">
							or copy and paste this URL into your browser:{" "}
							<Link
								href={props.inviteLink}
								className="text-blue-600 no-underline"
							>
								{props.inviteLink}
							</Link>
						</Text>
						{/* <Hr className="border border-solid border-[#eaeaea] my-[26px] mx-0 w-full" />
            <Text className="text-[#666666] text-[12px] leading-[24px]">
              This invitation was intended for{" "}
              <span className="text-black">{username}</span>. This invite was
              sent from <span className="text-black">{inviteFromIp}</span>{" "}
              located in{" "}
              <span className="text-black">{inviteFromLocation}</span>. If you
              were not expecting this invitation, you can ignore this email. If
              you are concerned about your account's safety, please reply to
              this email to get in touch with us.
            </Text> */}
					</Container>
				</Body>
			</Tailwind>
		</Html>
	);
}

TenantAdminInvite.PreviewProps = {
	invitedByEmail: "alan.turing@example.com",
	tenantName: "Enigma",
	inviteLink: "https://vercel.com/teams/invite/foo",
} as Props;

export default TenantAdminInvite;
