import { createRoot } from "react-dom/client";
import { DisplayPreview } from "./preview/DisplayPreview.js";
import { readProjectPreview } from "./preview/project-preview.js";

function PreviewEntry() {
  try {
    const token = new URLSearchParams(location.search).get("preview");
    if (!token) throw new Error("No project preview was supplied. Return to Studio and choose Preview from here.");
    return <DisplayPreview preview={readProjectPreview(token)} />;
  } catch (error) {
    return <main className="preview-error"><div><h1>Preview unavailable</h1><p>{error instanceof Error ? error.message : "The preview could not be opened."}</p></div></main>;
  }
}

createRoot(document.getElementById("root")!).render(<PreviewEntry />);
