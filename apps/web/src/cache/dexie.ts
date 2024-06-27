import Dexie from "dexie";

export type TableNames = "orgs" | "tenants" | "metadata";

class MattraxCache
	extends Dexie
	implements Record<TableNames, Dexie.Table<any, string>>
{
	orgs!: Dexie.Table<{ id: string; slug: string; name: string }, string>;
	tenants!: Dexie.Table<
		{ id: string; slug: string; name: string; orgId: string },
		string
	>;
	metadata!: Dexie.Table<{ table: string; last_updated: Date }, string>;

	VERSION = 3;

	constructor() {
		super("mattrax-cache");
		this.version(this.VERSION).stores({
			orgs: "id",
			tenants: "id, orgId, slug",
			metadata: "table",
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
