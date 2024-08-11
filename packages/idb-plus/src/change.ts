export type Changes = Map<string, Change[]>;

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
