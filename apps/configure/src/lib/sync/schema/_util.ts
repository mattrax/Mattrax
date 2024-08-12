import { z } from "zod";

export const assignmentTarget = z.discriminatedUnion("@odata.type", [
	z.object({
		"@odata.type": z.enum([
			"#microsoft.graph.exclusionGroupAssignmentTarget",
			"#microsoft.graph.groupAssignmentTarget",
		]),
		deviceAndAppManagementAssignmentFilterId: z.string().nullable(),
		deviceAndAppManagementAssignmentFilterType: z.enum([
			"none",
			"include",
			"exclude",
		]),
		groupId: z.string(),
	}),
	z.object({
		"@odata.type": z.enum([
			"#microsoft.graph.allLicensedUsersAssignmentTarget",
			"#microsoft.graph.allDevicesAssignmentTarget",
		]),
		deviceAndAppManagementAssignmentFilterId: z.string().nullable(),
		deviceAndAppManagementAssignmentFilterType: z.enum([
			"none",
			"include",
			"exclude",
		]),
	}),
]);
