import { stopE2ePocketBase } from "./helpers/pocketbase.js";

export default function globalTeardown(): void {
  stopE2ePocketBase();
}
