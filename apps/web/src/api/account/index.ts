import { Context } from "../utils/context";

const AccountContext = Context.create<{ id: string; pk: number }>("account");

export const useAccount = AccountContext.use;
export const useAccountSafe = () => {
	try {
		return useAccount();
	} catch {
		return null;
	}
};
export const withAccount = AccountContext.with;
