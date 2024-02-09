import { z } from "zod";
import { definePolicy } from "../definition";

export const chrome = definePolicy({
  AutoFillEnabled: {
    title: "AutoFillEnabled",
    description: "",
    supported: ["macOS", "Windows", "Linux"],
    schema: z.boolean(),
  },
  // CookiesAllowedForUrls
  // CookiesBlockedForUrls
  // CookiesSessionOnlyForUrls
  // ...
  // TODO: UI support for this
  //   ManagedBookmarks: {
  //     title: "ManagedBookmarks",
  //     description: "",
  //     schema: z.object({
  //       name: z.string(),
  //       url: z.string(),
  //     }),
  //   },
  // ...
});
