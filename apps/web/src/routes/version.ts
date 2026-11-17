import { DEPLOYMENT_HEADER, DEPLOYMENT_ID } from "~/lib/deployment";

/**
 * The build serving this origin, for tabs that outlived their deployment.
 *
 * No page component: `filesystem-routing` treats a route with handlers but no
 * default export as an endpoint only. `no-store` keeps an old build id out of
 * every cache between the Worker and the browser.
 */
const headers = {
  "cache-control": "no-store",
  [DEPLOYMENT_HEADER]: DEPLOYMENT_ID,
};

export const GET = () => Response.json({ build: DEPLOYMENT_ID }, { headers });

export const HEAD = () => new Response(null, { headers });
