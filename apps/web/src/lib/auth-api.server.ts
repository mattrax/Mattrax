import { fetchApi } from "~/server/api";

export async function apiFetch(request: Request) {
  "use server";

  return await fetchApi(request);
}
