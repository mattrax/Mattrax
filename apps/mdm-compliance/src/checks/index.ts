import { appleChecks } from "./apple.ts";
import { windowsChecks } from "./windows.ts";
import { androidChecks } from "./android.ts";
import { scepChecks } from "./scep.ts";

export const allChecks = [...appleChecks, ...windowsChecks, ...androidChecks, ...scepChecks];
