import { initializeApp } from "firebase-admin/app";
import { setGlobalOptions } from "firebase-functions/v2";
import { REGION } from "./config";

// One Admin SDK instance for every function in this codebase.
initializeApp();

// A hard ceiling on instances, so a runaway loop cannot turn into a bill.
setGlobalOptions({ region: REGION, maxInstances: 10 });

export { onUserCreate, setUserRole } from "./roles";
