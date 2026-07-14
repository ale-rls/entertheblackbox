import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@smartphonecracy/tool-ui/styles.css";
import { AdminProof } from "./proof.js";
import "./proof.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AdminProof />
  </StrictMode>,
);
