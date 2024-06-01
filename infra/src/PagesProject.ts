/// <reference path="../.sst/platform/config.d.ts" />

import type pulumi from "@pulumi/pulumi";

import { Component } from "../.sst/platform/src/components/component";

export interface PagesProjectDeploymentConfigsProduction
	extends cloudflare.types.input.PagesProjectDeploymentConfigsProduction {
	link?: pulumi.Input<any[]>;
}

export interface PagesProjectArgs extends cloudflare.PagesProjectArgs {
	deploymentConfigs?: pulumi.Input<{
		preview?: pulumi.Input<PagesProjectDeploymentConfigsProduction>;
		production?: pulumi.Input<PagesProjectDeploymentConfigsProduction>;
	}>;
}

export class PagesProject extends Component {
	inner: pulumi.Output<cloudflare.PagesProject>;

	constructor(
		name: string,
		args: PagesProjectArgs,
		opts?: pulumi.CustomResourceOptions,
	) {
		super(
			"sst:mattrax:cloudflare:PagesProject",
			`${name}MattraxWrapper`,
			{},
			{},
		);

		const linkData = $output(args.deploymentConfigs)?.apply((c) => {
			return {
				preview: sst.Link.build(c?.preview?.link ?? []),
				production: sst.Link.build(c?.production?.link ?? []),
			};
		});

		this.registerOutputs({
			_receiver: {
				links: $resolve([linkData]).apply(([{ preview, production }]) => {
					return [
						...new Set([
							...preview.map((p) => p.name),
							...production.map((p) => p.name),
						]),
					];
				}),
			},
		});

		this.inner = $resolve([linkData]).apply(([linkData]) => {
			args.deploymentConfigs = $output(args.deploymentConfigs).apply(
				(_configs) => {
					const configs = _configs ?? {};

					if (linkData.preview.length > 0) {
						configs.preview ??= {};
						configs.preview.secrets ??= {};

						for (const item of linkData.preview) {
							configs.preview.secrets[item.name] = JSON.stringify(
								item.properties,
							);
						}

						configs.preview.environmentVariables ??= {};
						configs.preview.environmentVariables.SST_RESOURCE_App =
							$jsonStringify({
								app: $app.name,
								stage: $app.stage,
							});

						configs.preview.link = undefined;
					}

					if (linkData.production.length > 0) {
						configs.production ??= {};
						configs.production.secrets ??= {};

						for (const item of linkData.preview) {
							configs.production.secrets[item.name] = JSON.stringify(
								item.properties,
							);
						}

						configs.production.environmentVariables ??= {};
						configs.production.environmentVariables.SST_RESOURCE_App =
							$jsonStringify({
								app: $app.name,
								stage: $app.stage,
							});

						configs.production.link = undefined;
					}

					return configs;
				},
			);

			return new cloudflare.PagesProject(name, args, opts);
		});
	}
}
