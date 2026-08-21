import { getAuth, connectAuthEmulator, type Auth } from "firebase/auth";
import { getApp } from "@/lib/storage/firebaseApp";
import { USE_EMULATOR } from "@/lib/firebaseEnv";

let cachedAuth: Auth | null = null;

export function getAuthClient(): Auth {
  if (cachedAuth) return cachedAuth;
  cachedAuth = getAuth(getApp());
  if (USE_EMULATOR) {
    connectAuthEmulator(cachedAuth, "http://127.0.0.1:9099", {
      disableWarnings: true,
    });
  }
  return cachedAuth;
}
