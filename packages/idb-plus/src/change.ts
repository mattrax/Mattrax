export type Changes = Map<string, Change[]>;

export type Changes2 = Record<
	string,
	{
		// TODO: Clear operations need to be orderer!
		put: Change[];
		delete: IDBValidKey[];
	}
>;

export type Change =
	| {
			type: "add" | "put" | "delete";
			// TODO: Allow this to be type-narrowed???
			key: IDBValidKey;
			// TODO: Allow this to be type-narrowed???
			value: any;
	  }
	| {
			type: "clear";
	  };
