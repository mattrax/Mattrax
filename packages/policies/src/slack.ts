import { z } from "zod";
import { definePolicy } from "./definition";

// https://slack.com/intl/en-au/help/articles/11906214948755-Manage-desktop-app-configurations
export const slack = definePolicy({
  AutoUpdate: {
    title: "AutoUpdate",
    description: "Enables or disables automatic updates of the desktop app.",
    schema: z.boolean(),
  },
  //   ClientEnvironment: {
  //     title: "ClientEnvironment",
  //     description: "Configures the client to run in either commercial mode or government compliance mode (GovSlack).",
  //     schema: z.boolean(), // TODO: How to express this schema???
  //   },
  DefaultSignInTeam: {
    title: "DefaultSignInTeam",
    description:
      "Sets a default workspace or org URL for users to sign in to on first launch.",
    schema: z.string(),
  },
  DownloadPath: {
    title: "DownloadPath",
    description: "Configures a download location. ",
    schema: z.string(),
  },
  HardwareAcceleration: {
    title: "HardwareAcceleration",
    description:
      "Enables or disables hardware accelerated rendering on the client.",
    schema: z.boolean(),
  },
});
