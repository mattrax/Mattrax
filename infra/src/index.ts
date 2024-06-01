/// <reference path="../.sst/platform/config.d.ts" />

import { MDMServer } from "./mdm";
import { Web } from "./web";

export function Infra() {
	Web();

	const mdm = MDMServer();

	return {
		mdmEC2: mdm.ec2.instance.arn,
	};
}
