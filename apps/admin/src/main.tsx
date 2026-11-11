import { ActorScript } from "./ActorScript.js";
import { createRoot } from "react-dom/client";
import "@entertheblackbox/tool-ui/styles.css";
import { App } from "./App.js";
import "./admin.css";

const root = createRoot(document.getElementById("root")!);
function renderRoute() {
  const readerToken = new URLSearchParams(window.location.hash.slice(1)).get("actor-script");
  root.render(readerToken ? <ActorScript key={readerToken} token={readerToken} /> : <App />);
}
window.addEventListener("hashchange", renderRoute);
renderRoute();
