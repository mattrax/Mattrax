/// <reference path="../.sst/platform/config.d.ts" />

import { domainZone } from "./cloudflare";
import { AWS_AZ } from "./constants";

export function MDMServer() {
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

	const userData = $resolve([
		tailscale.prodKey.key,
		new sst.Secret("DatabaseURL").value,
	]).apply(
		([tailscaleKey, databaseUrl]) => `#!/bin/bash
export DATABASE_URL="${databaseUrl}"
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
