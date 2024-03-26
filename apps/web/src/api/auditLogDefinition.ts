const type$ = <T>() => ({ "#ty": undefined! as T });

// Be aware this is used for the MySQL enum so changing order/names may require complex migrations
export const auditLogDefinition = {
	addIdp: type$<{ variant: string; remoteId: string }>(),
	removeIdp: type$<{ variant: string }>(),
	connectDomain: type$<{ domain: string }>(),
	disconnectDomain: type$<{ domain: string }>(),

	addDevice: type$<never>(), // TODO: Implement
	deviceAction: type$<never>(), // TODO: Implement
	removeDevice: type$<never>(), // TODO: Implement

	addPolicy: type$<{ id: string; name: string }>(),
	deployPolicy: type$<never>(), // TODO: Implement
	deletePolicy: type$<{ name: string }>(),

	addApp: type$<{ id: string; name: string }>(),
	editApp: type$<never>(), // TODO: Implement
	removeApp: type$<{ name: string }>(), // TODO: Implement

	addGroup: type$<{ id: string; name: string }>(),
	editGroup: type$<never>(), // TODO: Implement
	removeGroup: type$<{ name: string }>(), // TODO: Implement
} satisfies Record<string, { "#ty": any }>;
