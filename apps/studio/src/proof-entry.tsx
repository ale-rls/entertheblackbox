import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@smartphonecracy/tool-ui/styles.css";
import { StudioProof } from "./proof.js";
import "./proof.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StudioProof />
  </StrictMode>,
);
