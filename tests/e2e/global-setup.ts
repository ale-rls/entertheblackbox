import { startE2ePocketBase } from "./helpers/pocketbase.js";

export default async function globalSetup(): Promise<void> {
  await startE2ePocketBase();
}
