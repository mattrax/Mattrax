/// <reference path="./.sst/platform/config.d.ts" />

const CLOUDFLARE_ACCOUNT = "f02b3ef168fe64129e9941b4fb2e4dc1";
const CLOUDFLARE_ZONE = "mattrax.app";

const GITHUB_ORG = "mattrax";
const GITHUB_REPO = "Mattrax";
const GITHUB_REPO_BRANCH = "main";

const AWS_REGION = "us-east-1";
const AWS_AZ = "us-east-1a";

function cache<T>(cb: () => T) {
  let v: T;

  return () => (v ??= cb());
}

const INTERNAL_SECRET = cache(() => new sst.Secret("InternalSecret").value);
const MDM_URL = process.env.MDM_URL ?? "https://mdm.mattrax.app";

export default $config({
  app(input) {
    return {
      name: "mattrax",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "cloudflare",
      providers: {
        cloudflare: true,
        azuread: true,
        aws: { region: AWS_REGION },
        random: true,
        tailscale: true,
      },
    };
  },
  async run() {
    const domainZone = new cloudflare.Zone(
      "MattraxCloudflareZone",
      { accountId: CLOUDFLARE_ACCOUNT, zone: CLOUDFLARE_ZONE, plan: "free" },
      { protect: true },
    );

    // Application used for syncing user information from EntraID
    // WARNING: You must manually setup Publisher verification after deploying this
    const entraID = EntraID();

    const { sesIdentity } = Email({ domainZone });

    Web({ sesIdentity, entraID });

    MDMServer({ domainZone });
  },
});

function Email({ domainZone }: { domainZone: cloudflare.Zone }) {
  const sesIdentity = SESIdentity({ domainZone });

  // DMARC config
  new cloudflare.Record(
    "MattraxDNSDMARCRecord",
    {
      name: "_dmarc",
      value: `v=DMARC1; p=reject; rua=mailto:re+awpujuxug4y@dmarc.postmarkapp.com; adkim=r; aspf=r;`,
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
          name: "mattrax.app",
          value: `in${n}-smtp.messagingengine.com`,
          type: "MX",
          zoneId: domainZone.id,
          priority,
          comment: "MessagingEngine (FastMail) inbound mail",
        },
        { protect: true },
      ),
  );

  return { sesIdentity };
}

function SESIdentity({ domainZone }: { domainZone: cloudflare.Zone }) {
  const sesIdentity = new aws.ses.DomainIdentity("MattraxSESIdentity", {
    domain: domainZone.zone,
  });

  const sesDkim = new aws.ses.DomainDkim("MattraxSESDKIM", {
    domain: sesIdentity.domain,
  });

  sesDkim.dkimTokens.apply((tokens) =>
    tokens.map(
      (token) =>
        new cloudflare.Record(`MattraxCloudflareDKIMRecord${token}`, {
          name: token,
          value: token,
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
    value: `feedback-smtp.us-east-1.amazonses.com`,
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

  return sesIdentity;
}

function Web({
  sesIdentity,
  entraID,
}: {
  sesIdentity: aws.ses.DomainIdentity;
  entraID: ReturnType<typeof EntraID>;
}) {
  const awsUser = WebAWSUser({ sesIdentity });

  const pagesProject = WebPagesProject({ awsUser, entraID });

  return { awsUser, pagesProject };
}

function WebAWSUser({ sesIdentity }: { sesIdentity: aws.ses.DomainIdentity }) {
  const user = new aws.iam.User("MattraxWebIAMUser", {
    name: "mattrax-web-cloudflare",
  });

  new aws.iam.UserPolicy("MattraxWebIAMUserPolicy", {
    name: "SES",
    user: user.name,
    policy: sesIdentity.arn.apply((arn) =>
      aws.iam
        .getPolicyDocument({
          statements: [
            {
              effect: "Allow",
              actions: ["ses:SendEmail"],
              resources: [arn],
            },
          ],
        })
        .then((d) => d.json),
    ),
  });

  const accessKey = new aws.iam.AccessKey("MattraxWebIAMUserAccessKey", {
    user: user.name,
  });

  return { user, accessKey };
}

function WebPagesProject({
  awsUser,
  entraID,
}: {
  awsUser: ReturnType<typeof WebAWSUser>;
  entraID: ReturnType<typeof EntraID>;
}) {
  const deploymentConfig = {
    compatibilityDate: "2024-04-03",
    compatibilityFlags: ["nodejs_compat", "nodejs_als"],
    environmentVariables: {
      AWS_ACCESS_KEY_ID: awsUser.accessKey.id,
      AWS_SECRET_ACCESS_KEY: awsUser.accessKey.secret,
      ENTRA_CLIENT_ID: entraID.app.clientId,
      ENTRA_CLIENT_SECRET: entraID.appPassword.value,
      AUTH_SECRET: new random.RandomBytes("MattraxWebAuthSecret", {
        length: 64,
      }).base64,
      INTERNAL_SECRET: INTERNAL_SECRET(),
      MDM_URL,
      PLANETSCALE_URL: `https://:${INTERNAL_SECRET()}@${MDM_URL}`,
      FROM_ADDRESS: process.env.FROM_ADDRESS ?? "noreply@mattrax.app",
      PNPM_VERSION: "9.0.0",
      STRIPE_PUBLISHABLE_KEY:
        process.env.STRIPE_PUBLISHABLE_KEY ??
        "pk_test_51HWF7EHahv0c3616yp7ja6iTu2EDPzfnvd3cahDGHhPZQMAq8vqXa5QkJquWleLzkRK6KGppESxF8yZwWtBhCJzm00WAqF2c3k",

      STRIPE_SECRET_KEY: new sst.Secret("StripeSecretKey").value,
      FEEDBACK_DISCORD_WEBHOOK_URL: new sst.Secret("FeedbackDiscordWebhookURL")
        .value,
      WAITLIST_DISCORD_WEBHOOK_URL: new sst.Secret("WaitlistDiscordWebhookURL")
        .value,
    },
    failOpen: true,
    placement: { mode: "smart" },
    usageModel: "standard",
  } satisfies cloudflare.types.input.PagesProjectDeploymentConfigsProduction;

  return new cloudflare.PagesProject(
    "MattraxWeb",
    {
      accountId: CLOUDFLARE_ACCOUNT,
      name: "mattrax",
      productionBranch: "main",
      buildConfig: {
        buildCaching: true,
        buildCommand: "pnpm cbuild",
        destinationDir: "dist",
        rootDir: "apps/web",
      },
      deploymentConfigs: {
        preview: deploymentConfig,
        production: deploymentConfig,
      },
      source: {
        config: {
          owner: GITHUB_ORG,
          previewBranchIncludes: ["*"],
          productionBranch: GITHUB_REPO_BRANCH,
          repoName: GITHUB_REPO,
        },
        type: "github",
      },
    },
    { protect: true },
  );
}

function EntraID() {
  const app = new azuread.Application(
    "MattraxEntraIDApplication",
    {
      displayName: "Mattrax",
      featureTags: [
        {
          customSingleSignOn: false,
          enterprise: false,
          gallery: false,
          hide: false,
        },
      ],
      requiredResourceAccesses: [
        {
          resourceAccesses: [
            {
              id: "7427e0e9-2fba-42fe-b0c0-848c9e6a8182",
              type: "Scope",
            },
            {
              id: "a8ead177-1889-4546-9387-f25e658e2a79",
              type: "Scope",
            },
            {
              id: "e1fe6dd8-ba31-4d61-89e7-88639da4683d",
              type: "Scope",
            },
            {
              id: "9a5d68dd-52b0-4cc2-bd40-abcf44ac3a30",
              type: "Role",
            },
            {
              id: "dbb9058a-0e50-45d7-ae91-66909b5d4664",
              type: "Role",
            },
            {
              id: "df021288-bdef-4463-88db-98f22de89214",
              type: "Role",
            },
          ],
          resourceAppId: "00000003-0000-0000-c000-000000000000",
        },
      ],
      signInAudience: "AzureADMultipleOrgs",
      web: {
        redirectUris: [
          "https://cloud.mattrax.app",
          "http://localhost:3000",
        ].flatMap((origin) => [
          `${origin}/api/ms/link`,
          `${origin}/api/enrollment/callback`,
        ]),
      },
    },
    { protect: true },
  );

  const appPassword = new azuread.ApplicationPassword(
    "MattraxEntraIDApplicationPassword",
    {
      applicationId: app.id,
      displayName: "SST Client Secret",
    },
  );

  return { app, appPassword };
}

function MDMServer({ domainZone }: { domainZone: cloudflare.Zone }) {
  const tailscale = MDMServerTailscale();

  const ec2 = MDMServerEC2({ tailscale });

  // Basic DNS
  new cloudflare.Record("MattraxMDMServerDNSIPv4", {
    type: "A",
    zoneId: domainZone.id,
    name: "mdm",
    value: ec2.instance.publicIp,
  });

  new cloudflare.Record("MattraxMDMServerDNSIPv6", {
    type: "AAAA",
    zoneId: domainZone.id,
    name: "mdm",
    value: ec2.instance.ipv6Addresses[0],
  });

  // MS Enterprise Enrollment
  new cloudflare.Record("MattraxMDMServerDNSEEIPv4", {
    type: "A",
    zoneId: domainZone.id,
    name: "enterpriseenrollment",
    value: ec2.instance.publicIp,
  });

  new cloudflare.Record("MattraxMDMServerDNSEEIPv6", {
    type: "AAAA",
    zoneId: domainZone.id,
    name: "enterpriseenrollment",
    value: ec2.instance.ipv6Addresses[0],
  });

  return { ec2 };
}

function MDMServerEC2({
  tailscale,
}: {
  tailscale: ReturnType<typeof MDMServerTailscale>;
}) {
  const vpc = new aws.ec2.Vpc("MatraxMDMServerVPC", {
    assignGeneratedIpv6CidrBlock: true,
    cidrBlock: "10.0.0.0/16",
    enableDnsHostnames: true,
  });

  const securityGroup = new aws.ec2.SecurityGroup(
    "MattraxMDMServerVPCSecurityGroup",
    {
      description: "Allow HTTP & HTTPS for Mattrax",
      egress: [
        {
          cidrBlocks: ["0.0.0.0/0"],
          description: "",
          fromPort: 0,
          ipv6CidrBlocks: ["::/0"],
          prefixListIds: [],
          protocol: "-1",
          securityGroups: [],
          self: false,
          toPort: 0,
        },
      ],
      ingress: [
        {
          cidrBlocks: ["0.0.0.0/0"],
          description: "",
          fromPort: 80,
          ipv6CidrBlocks: ["::/0"],
          prefixListIds: [],
          protocol: "tcp",
          securityGroups: [],
          self: false,
          toPort: 80,
        },
        {
          cidrBlocks: ["0.0.0.0/0"],
          description: "",
          fromPort: 443,
          ipv6CidrBlocks: ["::/0"],
          prefixListIds: [],
          protocol: "tcp",
          securityGroups: [],
          self: false,
          toPort: 443,
        },
      ],
      name: "mattrax-web",
      vpcId: vpc.id,
    },
  );

  const internetGateway = new aws.ec2.InternetGateway(
    "MattraxMDMVPCInternetGateway",
    { vpcId: vpc.id },
  );

  const routeTable = new aws.ec2.RouteTable("MattraxMDMVPCRouteTable", {
    routes: [
      { cidrBlock: "0.0.0.0/0", gatewayId: internetGateway.id },
      { gatewayId: internetGateway.id, ipv6CidrBlock: "::/0" },
    ],
    vpcId: vpc.id,
  });

  const subnet = new aws.ec2.Subnet("MattraxMDMVPCSubnet", {
    vpcId: vpc.id,
    availabilityZone: AWS_AZ,
    cidrBlock: "10.0.1.0/24",
    assignIpv6AddressOnCreation: true, // Enable IPv6 address assignment for instances
    ipv6CidrBlock: vpc.ipv6CidrBlock.apply(
      (cidr) => `${cidr.split("::")[0]}::/64`,
    ), // Derive subnet's IPv6 CIDR from VPC's CIDR
    mapPublicIpOnLaunch: true,
    privateDnsHostnameTypeOnLaunch: "ip-name",
  });

  new aws.ec2.RouteTableAssociation(
    "MattraxMDMVPCSubnetRouteTableAssociation",
    { routeTableId: routeTable.id, subnetId: subnet.id },
  );

  new aws.ec2.DefaultNetworkAcl("MattraxMDMVPCDefaultNetworkAcl", {
    defaultNetworkAclId: vpc.defaultNetworkAclId,
    egress: [
      {
        action: "allow",
        cidrBlock: "0.0.0.0/0",
        fromPort: 0,
        protocol: "-1",
        ruleNo: 100,
        toPort: 0,
      },
      {
        action: "allow",
        fromPort: 0,
        ipv6CidrBlock: "::/0",
        protocol: "-1",
        ruleNo: 101,
        toPort: 0,
      },
    ],
    ingress: [
      {
        action: "allow",
        cidrBlock: "0.0.0.0/0",
        fromPort: 0,
        protocol: "-1",
        ruleNo: 100,
        toPort: 0,
      },
      {
        action: "allow",
        fromPort: 0,
        ipv6CidrBlock: "::/0",
        protocol: "-1",
        ruleNo: 101,
        toPort: 0,
      },
    ],
    subnetIds: [subnet.id],
  });

  const userData = tailscale.prodKey.key.apply(
    (tailscaleKey) => `#!/bin/bash
export DATABASE_URL="${process.env.DATABASE_URL}"
export TAILSCALE_AUTH_KEY="${tailscaleKey}"

curl -fsSL https://tailscale.com/install.sh | sh

sudo tailscale up --authkey $TAILSCALE_AUTH_KEY
sudo tailscale set --ssh

curl -fsSL https://mattrax.app/install.sh | CHANNEL=nightly sh
mattrax init "$DATABASE_URL"`,
  );

  const instance = new aws.ec2.Instance("MattraxMDMServerInstance", {
    ami: "ami-0092a7ee6b8b2222a",
    associatePublicIpAddress: true,
    availabilityZone: AWS_AZ,
    capacityReservationSpecification: {
      capacityReservationPreference: "open",
    },
    cpuOptions: {
      coreCount: 2,
      threadsPerCore: 1,
    },
    creditSpecification: {
      cpuCredits: "unlimited",
    },
    instanceInitiatedShutdownBehavior: "stop",
    instanceType: aws.ec2.InstanceType.T4g_Micro,
    keyName: "MyLaptopOrSomething",
    subnetId: subnet.id,
    tenancy: aws.ec2.Tenancy.Default,
    userData,
    userDataReplaceOnChange: true,
    vpcSecurityGroupIds: [securityGroup.id],
  });

  const eip = new aws.ec2.Eip("MattraxMDMServerEIP", {
    domain: "vpc",
    instance: instance.id,
  });

  return { instance, subnet, vpc, eip };
}

function MDMServerTailscale() {
  const prodKey = new tailscale.TailnetKey("MattraxMDMServerTailscaleKey", {
    preauthorized: true,
    reusable: true,
    ephemeral: true,
    tags: ["tag:prod"],
    description: "SST Prod Key",
  });

  return { prodKey };
}
