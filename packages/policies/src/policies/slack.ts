import { z } from "zod";
import { definePolicy } from "../definition";

// https://slack.com/intl/en-au/help/articles/11906214948755-Manage-desktop-app-configurations
export const slack = definePolicy({
  AutoUpdate: {
    title: "AutoUpdate",
    description: "Enables or disables automatic updates of the desktop app.",
    supported: ["macOS", "Windows", "Linux"],
    schema: z.boolean(),
  },
  //   ClientEnvironment: {
  //     title: "ClientEnvironment",
  //     description: "Configures the client to run in either commercial mode or government compliance mode (GovSlack).",
  //    supported: ["macOS", "Windows", "Linux"],
  //     schema: z.boolean(), // TODO: How to express this schema cause it's an int but also a dropdown???
  //   },
  DefaultSignInTeam: {
    title: "DefaultSignInTeam",
    description:
      "Sets a default workspace or org URL for users to sign in to on first launch.",
    supported: ["macOS", "Windows", "Linux"],
    schema: z.string(),
  },
  DownloadPath: {
    title: "DownloadPath",
    description: "Configures a download location. ",
    supported: ["macOS", "Windows", "Linux"],
    schema: z.string(),
  },
  HardwareAcceleration: {
    title: "HardwareAcceleration",
    description:
      "Enables or disables hardware accelerated rendering on the client.",
    supported: ["macOS", "Windows", "Linux"],
    schema: z.boolean(),
  },
});
