import {
  getFunctions,
  connectFunctionsEmulator,
  type Functions,
} from "firebase/functions";
import { getApp } from "@/lib/storage/firebaseApp";
import { FUNCTIONS_REGION, USE_EMULATOR } from "@/lib/firebaseEnv";

let cachedFunctions: Functions | null = null;

export function getFunctionsClient(): Functions {
  if (cachedFunctions) return cachedFunctions;
  cachedFunctions = getFunctions(getApp(), FUNCTIONS_REGION);
  if (USE_EMULATOR) connectFunctionsEmulator(cachedFunctions, "127.0.0.1", 5001);
  return cachedFunctions;
}
