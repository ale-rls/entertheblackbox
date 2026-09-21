import PocketBase from "pocketbase";
import { useEffect, useState } from "react";

type Media = { id: string; collectionId: string; src: string; file: string };

/** Browse the same collection as Studio; playback remains limited to published MP3s. */
export function AudioMediaLibrary({ url, sources, onSelect }: { url: string; sources: string[]; onSelect: (src: string) => void }) {
  const [files, setFiles] = useState<Array<Media & { preview: string }>>([]);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const pb = new PocketBase(url);
    let current = true;
    setError("");
    void pb.collection<Media>("media").getFullList({ sort: "src" }).then((records) => {
      if (current) setFiles(records.map((record) => ({ ...record, preview: pb.files.getURL(record, record.file) })));
    }).catch(() => { if (current) setError("Media library unavailable. Published tracks remain available below."); });
    return () => { current = false; pb.cancelAllRequests(); };
  }, [url, revision]);
  return <section aria-label="Media library">
    <div className="admin-section-heading"><h3>Media library</h3><button className="sc-tool-button" type="button" onClick={() => setRevision((value) => value + 1)}>Refresh library</button></div>
    {error && <p role="alert">{error}</p>}
    <ul className="admin-media-list">{files.map((file) => <li key={file.id}>
      <a href={file.preview} target="_blank" rel="noreferrer">{file.src}</a>
      {/\.mp3$/i.test(file.src) && <button className="sc-tool-button" type="button" disabled={!sources.includes(file.src)} onClick={() => onSelect(file.src)}>{sources.includes(file.src) ? "Select for music" : "Publish to use"}</button>}
    </li>)}</ul>
    {!error && !files.length && <p>No media loaded.</p>}
    <p className="sc-tool-help"><a href="/studio/" target="_blank" rel="noreferrer">Manage media in Studio</a>. Select a published MP3, then apply it in Background music.</p>
  </section>;
}
