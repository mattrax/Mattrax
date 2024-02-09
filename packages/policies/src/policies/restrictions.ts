import { z } from "zod";
import { definePolicy } from "../definition";

export const restrictions = definePolicy({
  camera: {
    title: "Camera",
    description: "The lord of IT herby declares selfies are banned",
    supported: [],
    schema: z.boolean(),
  },
  camera2: {
    title: "Camera2",
    description: "The lord of IT herby declares selfies are banned",
    supported: [],
    schema: z.boolean().default(true),
  },
  testing: {
    title: "Testing",
    description: "I do a little testing",
    supported: [],
    schema: z.union([
      z.string().describe("Testing"),
      z.string().describe("Testing2"),
    ]),
  },
  testing2: {
    title: "Testing2",
    description: "I do a little more testing",
    supported: [],
    schema: z.string(),
  },
});
