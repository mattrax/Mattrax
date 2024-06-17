import { domainZone } from "./cloudflare";

// DMARC config
new cloudflare.Record(
	"MattraxDNSDMARCRecord",
	{
		name: "_dmarc",
		value:
			"v=DMARC1; p=reject; rua=mailto:re+awpujuxug4y@dmarc.postmarkapp.com; adkim=r; aspf=r;",
		type: "TXT",
		zoneId: domainZone.id,
		comment: "DMARC Config",
	},
	{ protect: true },
);

// Fastmail config for Oscar
[
	[1, 10],
	[2, 20],
].map(
	([n, priority]) =>
		new cloudflare.Record(
			`MatraxDNSMXRecordMessagingEngine${n}`,
			{
				name: domainZone.zone,
				value: `in${n}-smtp.messagingengine.com`,
				type: "MX",
				zoneId: domainZone.id,
				priority,
				comment: "MessagingEngine (FastMail) inbound mail",
			},
			{ protect: true },
		),
);

export const sesIdentity = new aws.ses.DomainIdentity("MattraxSESIdentity", {
	domain: domainZone.zone,
});

const sesDkim = new aws.ses.DomainDkim("MattraxSESDKIM", {
	domain: sesIdentity.domain,
});

sesDkim.dkimTokens.apply((tokens) =>
	tokens.map(
		(token) =>
			new cloudflare.Record(`MattraxCloudflareDKIMRecord${token}`, {
				name: domainZone.zone.apply(
					(domain) => `${token}._domainkey.${domain}`,
				),
				value: `${token}.dkim.amazonses.com`,
				type: "CNAME",
				zoneId: domainZone.id,
				comment: "SES DKIM Record",
			}),
	),
);

const sesMailFrom = new aws.ses.MailFrom("MattraxSESMailFrom", {
	domain: sesIdentity.domain,
	mailFromDomain: sesIdentity.domain.apply((d) => `ses.${d}`),
});

new cloudflare.Record("MattraxMailFromMXRecord", {
	name: sesMailFrom.mailFromDomain,
	value: "feedback-smtp.us-east-1.amazonses.com",
	priority: 10,
	type: "MX",
	zoneId: domainZone.id,
	comment: "SES MailFrom Record",
});

new cloudflare.Record("MattraxMailFromTXTRecord", {
	name: "ses",
	value: `"v=spf1 include:amazonses.com ~all"`,
	type: "TXT",
	zoneId: domainZone.id,
	comment: "SES MailFrom Record",
});
