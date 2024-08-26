use rspc_openapi::OpenAPI;
use serde::Serialize;
use specta::Type;

use crate::util::{BaseProcedure, Router};

pub fn mount() -> Router {
    Router::new()
        .procedure("login", {
            <BaseProcedure>::builder()
                .with(OpenAPI::post("/auth/login").build())
                .mutation(|ctx, _: ()| async move { Ok(todo!()) })
        })
        .procedure("logout", {
            <BaseProcedure>::authenticated()
                .with(OpenAPI::post("/auth/logout").build())
                .mutation(|ctx, _: ()| async move { Ok(todo!()) })
        })
        .procedure("account", {
            // TODO: Use `specta::json`
            #[derive(Serialize, Type)]
            pub struct User {
                id: String,
                name: String,
                email: String,
            }

            <BaseProcedure>::authenticated()
                .with(OpenAPI::get("/auth/account").build())
                .query(|ctx, _: ()| async move {
                    let account = ctx
                        .db
                        .get_full_account(ctx.account.pk)
                        .await
                        .unwrap() // TODO: Error handling
                        .into_iter()
                        .next()
                        .unwrap(); // TODO: Error handling

                    Ok(User {
                        id: ctx.account.id,
                        name: account.name,
                        email: account.email,
                    })
                })
        })
        .procedure("editAccount", {
            <BaseProcedure>::authenticated()
                .with(OpenAPI::patch("/auth/account").build())
                .mutation(|ctx, _: ()| async move {
                    // TODO: Length validation

                    // Skip DB if we have nothing to update
                    // if (input.name !== undefined) {
                    // 	await db
                    // 		.update(accounts)
                    // 		.set({ name: input.name })
                    // 		.where(eq(accounts.pk, account.pk));
                    // }

                    Ok(todo!())
                })
        })
        .procedure("deleteAccount", {
            <BaseProcedure>::authenticated()
                .with(OpenAPI::delete("/auth/account").build())
                .mutation(|ctx, _: ()| async move {
                    // TODO: Require leaving all tenants

                    // TODO: Delete all sessions
                    // TODO: Delete account

                    Ok(todo!())
                })
        })
}
