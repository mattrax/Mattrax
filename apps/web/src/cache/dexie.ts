import Dexie from "dexie";

export type TableNames = "orgs" | "tenants";

class MattraxCache
	extends Dexie
	implements Record<TableNames, Dexie.Table<any, string>>
{
	orgs!: Dexie.Table<{ id: string; slug: string; name: string }, string>;
	tenants!: Dexie.Table<
		{ id: string; slug: string; name: string; orgId: string },
		string
	>;

	VERSION = 1;

	constructor() {
		super("mattrax-cache");
		this.version(this.VERSION).stores({
			orgs: "id",
			tenants: "id, orgId",
		});
	}
}

export type { MattraxCache };

export const mattraxCache = new MattraxCache();

export type TableData<TTable extends Dexie.Table> = TTable extends Dexie.Table<
	infer T
>
	? T
	: never;
