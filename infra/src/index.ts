/// <reference path="../.sst/platform/config.d.ts" />

import { Web } from "./web";
import { MDMServer } from "./mdm";

export function Infra() {
	Web();

	const mdm = MDMServer();

	return {
		mdmEC2: mdm.ec2.instance.arn,
	};
}
