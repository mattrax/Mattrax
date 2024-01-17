// import { createContext, useContext } from "solid-js";
// import { eq } from "drizzle-orm";
// import { SessionData, getServerSession } from "~/server/session";
// import { tenants } from "~/server/db/schema";
// import { db } from "~/server/db";
// import { encodeId } from "~/server/utils";

// export async function sessionLoader() {
//   "use server";

//   const session = await getServerSession();
//   if (!session?.data) {
//     return "unauthenticated" as const;
//   } else {
//     return {
//       id: session.data.id,
//       name: session.data.name,
//       email: session.data.email,
//     };
//   }
// }

// export type Tenant = Awaited<ReturnType<typeof tenantLoader>>[number];

// export async function tenantLoader(session_id: number) {
//   "use server";

//   return (
//     await db
//       .select({
//         id: tenants.id,
//         name: tenants.name,
//       })
//       .from(tenants)
//       .where(eq(tenants.owner_id, session_id))
//   ).map((tenant) => ({
//     ...tenant,
//     id: encodeId("tenant", tenant.id),
//   }));
// }

// type GlobalCtx = {
//   activeTenant: Tenant | null;
//   setActiveTenant: (tenant: string) => void;
//   session: SessionData;
//   tenants: Tenant[];
// };

// export const globalCtx = createContext<GlobalCtx>(undefined!);

// export const useGlobalCtx = () => {
//   const ctx = useContext(globalCtx);
//   if (!ctx) throw new Error("Missing 'globalCtx.Provider'");
//   return ctx;
// };

// // export const useSession = () => {
// //   const navigator = useNavigate();
// //   const session = useContext(sessionCtx);
// //   if (!session) {
// //     console.log("INLINE REDIRECT");
// //     // return navigator("/login");
// //   }
// //   // return new Proxy(session, {
// //   //   get(target, prop) {
// //   //     // if (prop in target) return target[prop];
// //   //     // throw new Error(`No session property "${prop}"`);
// //   //   },
// //   // });
// //   return session;
// // };
