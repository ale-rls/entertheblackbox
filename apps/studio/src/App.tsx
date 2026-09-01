import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent } from "react";
import PocketBase from "pocketbase";
import { addEdge, Background, ReactFlow, type Connection, type Edge, type Node, useEdgesState, useNodesState } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Autosave, recoverDraft, type SaveStatus as SaveStatusValue } from "./drafts.js";
import { PocketbaseDraftDatabase } from "./pocketbase-drafts.js";
import { exportArtifacts, exportBackup, importRuntime, importStudioFiles } from "./io.js";
import { autoLayout, type Draft } from "./model.js";
import { applyEdges, END_NODE_ID, ENTRY_NODE_ID, graphEdges, graphPhases, phaseOutputHandles, pruneEdges, reconcilePhaseOutputEdges, replacePluralityLayoutEdges, validateConnection, withoutOutputEdge } from "./canvas/graph.js";
import { nodeDataForPhase, nodeTypes } from "./canvas/nodes.js";
import { changePhaseKind, componentTypeForPhase, isImageAudioComponentType, phaseKindForComponentType, renamePhase, type AuthorableComponentType, type Phase } from "./inspector/model.js";
import { Inspector } from "./inspector/Inspector.js";
import { SessionHistory } from "./inspector/history.js";
import { DiagnosticsPanel } from "./diagnostics/DiagnosticsPanel.js";
import { diagnostics, exportBlocked } from "./diagnostics/diagnostics.js";
import { assembleDeploymentPackage } from "./export/deployment.js";
import { Menu } from "./chrome/Menu.js";
import { ConfirmationDialog, type ConfirmationDetails } from "./chrome/ConfirmationDialog.js";
import { SaveStatus } from "./chrome/SaveStatus.js";
import { refreshDraftLocalMedia, runtimeMediaManifest, type MediaManifest } from "./media/local.js";
import { PocketbaseMediaLibrary } from "./media/pocketbase-media.js";
import { MediaLibraryDialog, type MediaLibraryRow } from "./media/MediaLibraryDialog.js";
import { studioMediaKindForSource, type StudioMediaKind } from "./media/library.js";
import { appendCampaignExtension } from "./templates/campaign.js";
import { productionDraftFromArtifact, type PublishedProductionArtifact } from "./production.js";
import { projectPreviewUrl, storeProjectPreview } from "./preview/project-preview.js";
import "@smartphonecracy/tool-ui/styles.css";
import "./style.css";

const download = (name: string, value: unknown) => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: name });
  link.click();
  URL.revokeObjectURL(url);
};

type InlineFeedback = { status: "info" | "success" | "danger"; message: string };

const componentTypeLabel: Record<AuthorableComponentType, string> = {
  video: "video",
  "image-audio": "still image + MP3",
  "position-question": "position question",
  "video-position-question": "video + position vote",
  "image-audio-position-question": "still image + MP3 + position vote",
};

/** Default authoring rhythm: 15s decide, 5s vote, 5s result hold. */
const defaultVideoVoteTiming = (expectedDurationMs: number, originMs = 0) => {
  const openAtMs = Math.min(originMs + 15_000, expectedDurationMs - 2);
  const closeAtMs = Math.min(openAtMs + 5_000, expectedDurationMs - 1);
  return {
    showAtMs: originMs,
    openAtMs,
    closeAtMs,
    hideAtMs: Math.min(closeAtMs + 5_000, expectedDurationMs),
    closeCountdownSeconds: 5 as const,
  };
};

declare const __POCKETBASE_URL__: string;
const POCKETBASE_URL = __POCKETBASE_URL__;

function Feedback({ feedback, id, className = "" }: { feedback: InlineFeedback; id: string; className?: string }) {
  return <p id={id} className={`sc-tool-feedback studio-feedback ${className}`.trim()} data-sc-tool-status={feedback.status} role={feedback.status === "danger" ? "alert" : "status"} aria-atomic="true">{feedback.message}</p>;
}

const nodesForDraft = (draft: Draft, current: Node[] = []): Node[] => {
  const layout = new Map(draft.document.nodes.map((node) => [node.id, node]));
  const currentPositions = new Map(current.map((node) => [node.id, node.position]));
  const phaseNodes: Node[] = graphPhases(draft.project).map((phase, index) => {
    const data = nodeDataForPhase(phase);
    return {
      id: phase.id,
      type: "phase",
      position: currentPositions.get(phase.id) ?? layout.get(phase.id) ?? { x: 360 + (index % 3) * 300, y: 80 + Math.floor(index / 3) * 220 },
      data,
      ariaLabel: `${phase.kind === "position-question" || phase.kind === "video-position-question" ? "Question" : phase.kind} phase: ${data.label}`,
    };
  });
  return [
    { id: ENTRY_NODE_ID, type: "entry", deletable: false, position: currentPositions.get(ENTRY_NODE_ID) ?? layout.get(ENTRY_NODE_ID) ?? { x: 30, y: 80 }, data: {}, ariaLabel: "Show entry" },
    ...phaseNodes,
    { id: END_NODE_ID, type: "end", deletable: false, position: currentPositions.get(END_NODE_ID) ?? layout.get(END_NODE_ID) ?? { x: 1250, y: 500 }, data: {}, ariaLabel: "Show end" },
  ];
};

const edgesForDraft = (draft: Draft): Edge[] => {
  const nodeIds = new Set([ENTRY_NODE_ID, ...graphPhases(draft.project).map((phase) => phase.id), END_NODE_ID]);
  const documentEdges = draft.document.edges;
  const usesCurrentCanvasFormat = draft.document.canvasFormatVersion === 1 && documentEdges.every((edge) =>
    edge.sourceHandle != null && nodeIds.has(edge.source) && nodeIds.has(edge.target),
  );
  return usesCurrentCanvasFormat ? documentEdges : graphEdges(draft.project);
};

export function App() {
  const db = useMemo(() => new PocketbaseDraftDatabase(POCKETBASE_URL), []);
  const media = useMemo(() => new PocketbaseMediaLibrary(POCKETBASE_URL), []);
  const autosave = useMemo(() => new Autosave(db), [db]);
  const [recent, setRecent] = useState<Draft[]>([]);
  const [draft, setDraft] = useState<Draft>();
  const [status, setStatus] = useState<SaveStatusValue>("saved");
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set());
  const [showInspector, setShowInspector] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(true);
  const [localManifest, setLocalManifest] = useState<MediaManifest>();
  const [mediaLibraryOpen, setMediaLibraryOpen] = useState(false);
  const [mediaPicker, setMediaPicker] = useState<{ phaseId: string; target: "src" | "audioSrc"; mediaKind: Exclude<StudioMediaKind, "unknown">; trigger: HTMLButtonElement | null }>();
  const [mediaUploading, setMediaUploading] = useState(false);
  const [importFeedback, setImportFeedback] = useState<InlineFeedback>();
  const [graphFeedback, setGraphFeedback] = useState<InlineFeedback>();
  const [exportFeedback, setExportFeedback] = useState<InlineFeedback>();
  const [publishOpen, setPublishOpen] = useState(false);
  const [productionImportOpen, setProductionImportOpen] = useState(false);
  const [publishForm, setPublishForm] = useState({ showId: "", name: "" });
  const [publishing, setPublishing] = useState(false);
  const [publishFeedback, setPublishFeedback] = useState<InlineFeedback>();
  const [signInForm, setSignInForm] = useState({ email: "", password: "" });
  const [signingIn, setSigningIn] = useState(false);
  const [signInFeedback, setSignInFeedback] = useState<InlineFeedback>();
  // A plain PocketBase client's default LocalAuthStore persists to
  // localStorage under a fixed key shared by every PocketBase instance on
  // the page (db/media use their own instances against the same storage),
  // so a prior sign-in here is restored automatically -- publishing no
  // longer needs to re-prompt for credentials every time, only once every
  // ~30 days (operators auth collection's token duration).
  const operatorPb = useMemo(() => new PocketBase(POCKETBASE_URL), []);
  const [operatorEmail, setOperatorEmail] = useState<string | null>(
    operatorPb.authStore.isValid ? ((operatorPb.authStore.record as { email?: string } | null)?.email ?? "operator") : null,
  );
  useEffect(() => operatorPb.authStore.onChange((_token, record) => {
    setOperatorEmail(operatorPb.authStore.isValid ? ((record as { email?: string } | null)?.email ?? "operator") : null);
  }), [operatorPb]);
  const [confirmation, setConfirmation] = useState<ConfirmationDetails>();
  const importInputRef = useRef<HTMLInputElement>(null);
  const homeHeadingRef = useRef<HTMLHeadingElement>(null);
  const editorRef = useRef<HTMLElement>(null);
  type HistoryState = { draft: Draft; edges: Edge[] };
  const history = useRef<SessionHistory<HistoryState>>();

  useEffect(() => void db.list().then(setRecent), [db]);
  useEffect(() => {
    void media.list().then((manifest) => {
      if (manifest) setLocalManifest(manifest);
    });
  }, [media]);
  useEffect(() => {
    if (!draft || !localManifest) return;
    save(refreshDraftLocalMedia(draft, localManifest));
  }, [localManifest, draft?.id]);
  useEffect(() => {
    if (!draft) return;
    setNodes(nodesForDraft(draft));
    setEdges(edgesForDraft(draft));
  }, [draft?.id, setEdges, setNodes]);
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 });
  }, [Boolean(draft)]);

  const save = (next: Draft) => {
    setDraft(next);
    autosave.schedule(next, (value) => {
      setStatus(value);
      if (value === "saved") void db.list().then(setRecent);
    });
  };
  const canvasDraft = (next: Draft, nextNodes = nodes, nextEdges = edges): Draft => {
    let project = next.project;
    try { project = applyEdges(project, nextEdges); } catch { /* Preserve incomplete Studio wiring until it is repaired. */ }
    return {
      ...next,
      project,
      document: {
        ...next.document,
        canvasFormatVersion: 1,
        nodes: nextNodes.map((node) => ({ id: node.id, x: node.position.x, y: node.position.y })),
        edges: nextEdges,
      },
      updatedAt: Date.now(),
    };
  };
  const saveCanvas = (next: Draft, nextNodes = nodes, nextEdges = edges) => save(canvasDraft(next, nextNodes, nextEdges));
  const applyHistory = (state: HistoryState) => {
    const nextNodes = nodesForDraft(state.draft, nodes);
    setNodes(nextNodes);
    setEdges(state.edges);
    saveCanvas(state.draft, nextNodes, state.edges);
  };
  const record = (nextDraft: Draft, nextEdges = edges) => {
    if (!history.current || history.current.value.draft.id !== nextDraft.id) history.current = new SessionHistory({ draft: draft ?? nextDraft, edges });
    applyHistory(history.current.apply({ draft: nextDraft, edges: nextEdges }));
  };
  const readImportFile = async (file: File) => {
    const text = await file.text();
    if (file.name.toLowerCase().endsWith(".txt")) return { name: file.name, value: text };
    try {
      return { name: file.name, value: JSON.parse(text) as unknown };
    } catch {
      throw new Error(`${file.name} is not valid JSON.`);
    }
  };
  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setImportFeedback(undefined);
    try {
      const parsed = await Promise.all([...files].map(readImportFile));
      const imported = importStudioFiles(parsed);
      history.current = undefined;
      save(imported.draft);
      setImportFeedback({ status: "success", message: imported.message });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "The selected files could not be read.";
      setImportFeedback({ status: "danger", message: `Import failed: ${detail} Choose a Studio backup, or select scenario.json and media-manifest.json together.` });
    }
  };
  const addMedia = async (files: FileList | null) => {
    if (!files?.length) return;
    setMediaUploading(true);
    const selected = [...files];
    const added: string[] = [];
    const failed: Array<{ name: string; reason: string }> = [];
    for (const [index, file] of selected.entries()) {
      setImportFeedback({ status: "info", message: `Adding ${file.name} (${index + 1} of ${selected.length})…` });
      try {
        await media.upload(file);
        added.push(file.name);
      } catch (error) {
        failed.push({ name: file.name, reason: error instanceof Error ? error.message : "The media file could not be added." });
      }
    }

    try {
      const manifest = await media.list();
      if (manifest) setLocalManifest(manifest);
      const addedSummary = added.length ? `Added ${added.length}: ${added.join(", ")}.` : "No media files were added.";
      const failedSummary = failed.length
        ? ` Failed ${failed.length}: ${failed.map(({ name, reason }) => `${name} — ${reason}`).join("; ")}`
        : "";
      if (!manifest) {
        setImportFeedback({ status: "danger", message: `Upload finished, but the library could not be refreshed. ${addedSummary}${failedSummary} Check that PocketBase is reachable and reopen the library.` });
      } else if (failed.length) {
        setImportFeedback({ status: "danger", message: `${addedSummary}${failedSummary}` });
      } else {
        setImportFeedback({ status: "success", message: `${addedSummary} The media library is up to date.` });
      }
    } finally {
      setMediaUploading(false);
    }
  };
  const duplicate = (source: Draft) => save({ ...structuredClone(source), id: crypto.randomUUID(), name: `${source.name} copy`, updatedAt: Date.now() });
  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    setSigningIn(true);
    setSignInFeedback(undefined);
    try {
      await operatorPb.collection("operators").authWithPassword(signInForm.email, signInForm.password);
      setSignInForm({ email: "", password: "" });
    } catch {
      setSignInFeedback({ status: "danger", message: "Invalid operator email or password." });
    } finally {
      setSigningIn(false);
    }
  };
  const signOut = () => operatorPb.authStore.clear();
  const importLatestProduction = async () => {
    if (!operatorPb.authStore.isValid) {
      setProductionImportOpen(true);
      return;
    }
    setImportFeedback({ status: "info", message: "Loading the active production scenario…" });
    try {
      const response = await fetch("/api/admin/shows/latest", {
        headers: { Authorization: `Bearer ${operatorPb.authStore.token}` },
      });
      if (!response.ok) throw new Error(response.status === 404 ? "No active published production show was found." : `Production import failed (${response.status}).`);
      const artifact = await response.json() as PublishedProductionArtifact;
      const imported = productionDraftFromArtifact(artifact);
      if (localManifest) imported.localMediaSources = localManifest.files.map((file) => file.src).sort();
      history.current = undefined;
      save(imported);
      setProductionImportOpen(false);
      setImportFeedback({ status: "success", message: `Created a draft from ${artifact.name} ${artifact.version}, published ${new Date(artifact.publishedAt).toLocaleString()}.` });
    } catch (error) {
      setImportFeedback({ status: "danger", message: error instanceof Error ? error.message : "Production import failed." });
    }
  };
  const createShow = () => {
    const created = importRuntime({
      version: "1.0.0",
      entryPhaseId: "idle",
      cyclesAllowed: false,
      phases: [{ id: "idle", kind: "idle" }],
    }, localManifest ? runtimeMediaManifest(localManifest) : { files: [] }, "Untitled show");
    if (localManifest) created.localMediaSources = localManifest.files.map((file) => file.src).sort();
    history.current = undefined;
    save(created);
  };
  const addCampaignExtension = (trigger: HTMLButtonElement | null = null) => {
    if (!draft) return;
    const productionBaseline = draft.document.productionBaseline;
    if (!productionBaseline) {
      setGraphFeedback({ status: "danger", message: "Create a draft from active production before applying the campaign extension." });
      return;
    }
    setConfirmation({
      title: "Append campaign and election sections 3–5?",
      description: "This changes the production ending from idle to the campaign intro, then adds three spectrum speeches with applause/boo, the three-zone election, winner visions, tie/empty endings, and the final return to idle. New media references must be uploaded before publishing.",
      confirmLabel: "Append sections 3–5",
      cancelLabel: "Keep production unchanged",
      tone: "primary",
      trigger,
      onConfirm: () => {
        try {
          const project = appendCampaignExtension(draft.project);
          const document = {
            ...autoLayout(project, draft.document.showId),
            productionBaseline,
          };
          const nextDraft = { ...draft, project, document, updatedAt: Date.now() };
          const nextNodes = nodesForDraft(nextDraft);
          const nextEdges = graphEdges(project);
          setNodes(nextNodes);
          setEdges(nextEdges);
          record(nextDraft, nextEdges);
          setGraphFeedback({ status: "success", message: "Sections 3–5 appended. Upload or select the new media files, then preview every election outcome." });
        } catch (error) {
          setGraphFeedback({ status: "danger", message: error instanceof Error ? error.message : "The campaign extension could not be added." });
        }
      },
    });
  };
  const closeConfirmation = () => {
    const trigger = confirmation?.trigger;
    setConfirmation(undefined);
    queueMicrotask(() => {
      if (trigger?.isConnected) trigger.focus();
      else (homeHeadingRef.current ?? editorRef.current)?.focus();
    });
  };
  const remove = (source: Draft, trigger: HTMLButtonElement) => {
    setConfirmation({
      title: `Delete “${source.name}”?`,
      description: "This permanently removes the local draft and its Studio revision history from this browser. Exported files are not affected.",
      confirmLabel: "Delete draft",
      cancelLabel: "Keep draft",
      tone: "danger",
      trigger,
      onConfirm: async () => {
        try {
          await db.delete(source.id);
          if (draft?.id === source.id) setDraft(undefined);
          setRecent(await db.list());
          setImportFeedback({ status: "success", message: `Deleted “${source.name}” from this browser.` });
        } catch (error) {
          setImportFeedback({ status: "danger", message: `Draft deletion failed: ${error instanceof Error ? error.message : "The browser could not remove this draft."}` });
        }
      },
    });
  };
  const requestMediaRemoval = (row: MediaLibraryRow, trigger: HTMLButtonElement) => {
    const usage = draft === undefined
      ? " No show is currently open, so phase usage has not been checked."
      : row.references.length > 0
      ? ` It is used by ${row.references.join(", ")}; those phases will report missing media until another file is selected.`
      : " It is not used by the current show.";
    setConfirmation({
      title: `Remove “${row.src}” from the media library?`,
      description: `This permanently deletes the shared PocketBase media file.${usage}`,
      confirmLabel: "Remove media",
      cancelLabel: "Keep media",
      tone: "danger",
      trigger,
      onConfirm: async () => {
        try {
          await media.remove(row.src);
          const manifest = await media.list();
          if (manifest) setLocalManifest(manifest);
          setImportFeedback(manifest
            ? { status: "success", message: `Removed ${row.src} from the media library.` }
            : { status: "danger", message: `Removed ${row.src}, but the library could not be refreshed.` });
        } catch (error) {
          setImportFeedback({ status: "danger", message: error instanceof Error ? error.message : `Could not remove ${row.src}.` });
        }
      },
    });
  };
  const openMediaLibrary = () => {
    setMediaPicker(undefined);
    setMediaLibraryOpen(true);
  };
  const openMediaPicker = (phaseId: string, target: "src" | "audioSrc", mediaKind: Exclude<StudioMediaKind, "unknown">, trigger: HTMLButtonElement | null = null) => {
    setMediaLibraryOpen(false);
    setMediaPicker({ phaseId, target, mediaKind, trigger });
  };
  const closeMediaPicker = () => {
    const trigger = mediaPicker?.trigger;
    setMediaPicker(undefined);
    queueMicrotask(() => {
      if (trigger?.isConnected) trigger.focus();
      else editorRef.current?.focus();
    });
  };
  const closeShow = () => {
    setDraft(undefined);
    setNodes([]);
    setEdges([]);
    setSelectedId(undefined);
    setMediaLibraryOpen(false);
    setMediaPicker(undefined);
  };
  const persistGraph = (nextEdges: Edge[]) => {
    if (!draft) return;
    saveCanvas(draft, nodes, nextEdges);
  };
  const connect = (connection: Connection) => {
    if (!draft) return;
    const sourceHandle = connection.sourceHandle ?? "next";
    // Dragging an already-connected output means rewire it. React Flow's
    // connection event does not remove the previous edge for us.
    const retained = withoutOutputEdge(edges, connection.source, sourceHandle);
    const problem = validateConnection(draft.project, retained, connection);
    if (problem) {
      setGraphFeedback({ status: "danger", message: `Connection not made: ${problem} Adjust the source or target, then try again.` });
      return;
    }
    const next = addEdge({ ...connection, id: `${connection.source}:${sourceHandle}` }, retained);
    setEdges(next);
    persistGraph(next);
    setGraphFeedback({ status: "success", message: "Connection updated." });
  };
  const addPhase = (kind: "idle" | "video" | "image-audio" | "position-question" | "video-position-question" | "image-audio-position-question") => {
    if (!draft) return;
    if (kind === "idle" && draft.project.scenario.phases.some((phase) => phase.kind === "idle")) {
      setGraphFeedback({ status: "danger", message: "Idle phase not added: this show already has its idle phase. Select the existing idle phase to edit it." });
      return;
    }
    setGraphFeedback(undefined);
    const id = kind === "idle" ? "idle" : `${kind}-${crypto.randomUUID().slice(0, 6)}`;
    const imageAudio = kind === "image-audio" || kind === "image-audio-position-question";
    const mediaVote = kind === "video-position-question" || kind === "image-audio-position-question";
    const firstVisual = draft.project.manifest.files.find((file) => studioMediaKindForSource(file.src) === (imageAudio ? "image" : "video"));
    const firstAudio = imageAudio ? draft.project.manifest.files.find((file) => studioMediaKindForSource(file.src) === "audio") : undefined;
    const durationSource = firstAudio ?? firstVisual;
    const detectedDuration = localManifest?.files.find((file) => file.src === durationSource?.src)?.durationMs;
    const tailDurationMs = imageAudio ? (mediaVote ? 25_000 : 1_000) : 0;
    const expectedDurationMs = (detectedDuration ?? (mediaVote ? 40_000 : 1_000)) + tailDurationMs;
    const mediaDurationMs = expectedDurationMs - tailDurationMs;
    const mediaFields = {
      src: firstVisual?.src ?? (imageAudio ? "media/new-image.jpg" : "media/new-video.mp4"),
      ...(imageAudio ? { audioSrc: firstAudio?.src ?? "media/new-audio.mp3", tailDurationMs } : {}),
      expectedDurationMs,
    };
    const phase = kind === "idle" ? { kind, id: "idle" as const }
      : kind === "position-question"
        ? { kind, id, text: "New position question", field: { type: "four-quadrant" as const, xAxis: { minLabel: "Left", maxLabel: "Right" }, yAxis: { minLabel: "Top", maxLabel: "Bottom" } }, durationMs: 60000, freezeMs: 5000, connectionStaleAfterMs: 10000, showLiveCounts: true, next: { type: "quadrant-plurality" as const, map: { q1: "idle", q2: "idle", q3: "idle", q4: "idle" }, tie: "idle", empty: "idle", countedStatuses: ["valid", "stale", "disconnected"] as const } }
        : mediaVote
          ? { kind: "video-position-question" as const, id, ...mediaFields, text: "New position question", field: { type: "four-quadrant" as const, xAxis: { minLabel: "Left", maxLabel: "Right" }, yAxis: { minLabel: "Top", maxLabel: "Bottom" } }, ...defaultVideoVoteTiming(expectedDurationMs, imageAudio ? mediaDurationMs : 0), connectionStaleAfterMs: 10000, showLiveCounts: true, next: { type: "quadrant-plurality" as const, map: { q1: "idle", q2: "idle", q3: "idle", q4: "idle" }, tie: "idle", empty: "idle", countedStatuses: ["valid", "stale", "disconnected"] as const } }
          : { kind: "video" as const, id, ...mediaFields, next: "idle" };
    const phases = [...draft.project.scenario.phases, phase] as Draft["project"]["scenario"]["phases"];
    const nextNodes = [...nodes, { id, type: "phase", position: { x: 400, y: 200 }, data: nodeDataForPhase(phase as Phase) }];
    const handles = phaseOutputHandles(phase as Phase);
    const nextEdges = [...edges, ...handles.map((handle) => ({ id: `${id}:${handle}`, source: id, sourceHandle: handle, target: END_NODE_ID }))];
    setNodes(nextNodes);
    setEdges(nextEdges);
    saveCanvas({ ...draft, project: { ...draft.project, scenario: { ...draft.project.scenario, phases } } }, nextNodes, nextEdges);
    if (phase.kind === "video" || phase.kind === "video-position-question") {
      setSelectedId(id);
      setShowInspector(true);
      openMediaPicker(id, "src", imageAudio ? "image" : "video");
    }
  };
  const updatePhase = (nextPhase: Phase) => {
    if (!draft) return;
    const currentPhase = draft.project.scenario.phases.find((phase) => phase.id === nextPhase.id);
    const handlesChanged = phaseOutputHandles(currentPhase).join("\u0000") !== phaseOutputHandles(nextPhase).join("\u0000");
    const nextEdges = handlesChanged ? reconcilePhaseOutputEdges(edges, nextPhase) : edges;
    const phases = draft.project.scenario.phases.map((phase) => phase.id === nextPhase.id ? nextPhase : phase) as Draft["project"]["scenario"]["phases"];
    record({ ...draft, project: { ...draft.project, scenario: { ...draft.project.scenario, phases } }, updatedAt: Date.now() }, nextEdges);
    setNodes((current) => current.map((node) => node.id === nextPhase.id ? { ...node, data: nodeDataForPhase(nextPhase) } : node));
  };
  const selectMedia = (row: MediaLibraryRow) => {
    if (!draft || !mediaPicker) return;
    const phase = draft.project.scenario.phases.find((item) => item.id === mediaPicker.phaseId);
    if (!phase || (phase.kind !== "video" && phase.kind !== "video-position-question")) {
      closeMediaPicker();
      return;
    }
    const nextPhase = mediaPicker.target === "audioSrc" && row.durationMs !== undefined
      ? (() => {
          const previousAudioDurationMs = phase.expectedDurationMs - (phase.tailDurationMs ?? 0);
          const shiftMs = row.durationMs - previousAudioDurationMs;
          return phase.kind === "video-position-question"
            ? { ...phase, audioSrc: row.src, expectedDurationMs: row.durationMs + (phase.tailDurationMs ?? 0), showAtMs: phase.showAtMs + shiftMs, openAtMs: phase.openAtMs + shiftMs, closeAtMs: phase.closeAtMs + shiftMs, hideAtMs: phase.hideAtMs + shiftMs }
            : { ...phase, audioSrc: row.src, expectedDurationMs: row.durationMs + (phase.tailDurationMs ?? 0) };
        })()
      : mediaPicker.target === "audioSrc"
        ? { ...phase, audioSrc: row.src }
        : { ...phase, src: row.src, ...(phase.audioSrc === undefined && row.durationMs !== undefined ? { expectedDurationMs: row.durationMs } : {}) };
    updatePhase(nextPhase);
    setImportFeedback({ status: "success", message: `Selected ${row.src} for ${phase.id}.` });
    closeMediaPicker();
  };
  const updateTargetAudienceSize = (targetAudienceSize: number) => {
    if (!draft) return;
    record({ ...draft, project: { ...draft.project, scenario: { ...draft.project.scenario, targetAudienceSize } }, updatedAt: Date.now() });
  };
  const renameSelected = (nextId: string) => {
    if (!draft || !selectedId) return;
    const project = renamePhase(draft.project, selectedId, nextId);
    const nextEdges = edges.map((edge) => ({ ...edge, id: edge.id.replace(`${selectedId}:`, `${nextId}:`), source: edge.source === selectedId ? nextId : edge.source, target: edge.target === selectedId ? nextId : edge.target }));
    record({ ...draft, project, document: { ...draft.document, nodes: draft.document.nodes.map((node) => node.id === selectedId ? { ...node, id: nextId } : node), edges: nextEdges }, updatedAt: Date.now() }, nextEdges);
    setNodes((current) => current.map((node) => node.id === selectedId ? { ...node, id: nextId, data: { ...node.data, label: nextId } } : node));
    setSelectedId(nextId);
  };
  const changeSelectedComponentType = (componentType: AuthorableComponentType, trigger: HTMLSelectElement) => {
    if (!draft || !selectedId) return;
    const phase = draft.project.scenario.phases.find((item) => item.id === selectedId);
    if (!phase) return;
    const currentComponentType = componentTypeForPhase(phase);
    if (phase.kind === "idle" || currentComponentType === "idle" || currentComponentType === componentType) return;
    const kind = phaseKindForComponentType(componentType);
    const convertPlaybackFormat = (mediaPhase: Extract<Phase, { kind: "video" | "video-position-question" }>) => {
      if (!isImageAudioComponentType(componentType)) {
        const video = studioMediaKindForSource(mediaPhase.src) === "video"
          ? mediaPhase.src
          : draft.project.manifest.files.find((file) => studioMediaKindForSource(file.src) === "video")?.src ?? "media/new-video.mp4";
        const expectedDurationMs = localManifest?.files.find((file) => file.src === video)?.durationMs ?? mediaPhase.expectedDurationMs;
        if (mediaPhase.kind === "video") {
          return { ...mediaPhase, src: video, audioSrc: undefined, tailDurationMs: undefined, expectedDurationMs };
        }
        return {
          ...mediaPhase,
          src: video,
          audioSrc: undefined,
          tailDurationMs: undefined,
          expectedDurationMs,
          ...defaultVideoVoteTiming(expectedDurationMs),
        };
      }
      const image = studioMediaKindForSource(mediaPhase.src) === "image"
        ? mediaPhase.src
        : draft.project.manifest.files.find((file) => studioMediaKindForSource(file.src) === "image")?.src ?? "media/new-image.jpg";
      const audio = mediaPhase.audioSrc
        ?? draft.project.manifest.files.find((file) => studioMediaKindForSource(file.src) === "audio")?.src
        ?? "media/new-audio.mp3";
      const tailDurationMs = mediaPhase.tailDurationMs ?? (mediaPhase.kind === "video-position-question" ? 25_000 : 1_000);
      const mediaDurationMs = localManifest?.files.find((file) => file.src === audio)?.durationMs
        ?? Math.max(1, mediaPhase.expectedDurationMs - (mediaPhase.tailDurationMs ?? 0));
      const expectedDurationMs = mediaDurationMs + tailDurationMs;
      if (mediaPhase.kind === "video") {
        return { ...mediaPhase, src: image, audioSrc: audio, tailDurationMs, expectedDurationMs };
      }
      return {
        ...mediaPhase,
        src: image,
        audioSrc: audio,
        tailDurationMs,
        expectedDurationMs,
        ...defaultVideoVoteTiming(expectedDurationMs, mediaDurationMs),
      };
    };
    if (phase.kind === kind && (phase.kind === "video" || phase.kind === "video-position-question")) {
      updatePhase(convertPlaybackFormat(phase));
      setGraphFeedback({ status: "success", message: `Changed ${phase.id} to ${isImageAudioComponentType(componentType) ? "still image + MP3" : "video"}.` });
      return;
    }
    const phaseKind = componentTypeLabel[currentComponentType];
    const nextKind = componentTypeLabel[componentType];
    setConfirmation({
      title: `Change “${phase.id}” from ${phaseKind} to ${nextKind}?`,
      description: "This replaces the phase fields and all outgoing connections. You can undo this change during this editing session.",
      confirmLabel: "Change component type",
      cancelLabel: "Keep current type",
      tone: "primary",
      trigger,
      onConfirm: () => {
        const changedPhase = changePhaseKind(phase, kind);
        const nextPhase = changedPhase.kind === "video" || changedPhase.kind === "video-position-question"
          ? convertPlaybackFormat(changedPhase)
          : changedPhase;
        const retained = edges.filter((edge) => edge.source !== selectedId);
        const nextEdges = [
          ...retained,
          ...phaseOutputHandles(nextPhase).map((handle) => ({ id: `${nextPhase.id}:${handle}`, source: nextPhase.id, sourceHandle: handle, target: END_NODE_ID })),
        ];
        const phases = draft.project.scenario.phases.map((item) => item.id === selectedId ? nextPhase : item) as Draft["project"]["scenario"]["phases"];
        record({ ...draft, project: { ...draft.project, scenario: { ...draft.project.scenario, phases } }, document: { ...draft.document, edges: nextEdges }, updatedAt: Date.now() }, nextEdges);
        setNodes((current) => current.map((node) => node.id === selectedId ? { ...node, data: nodeDataForPhase(nextPhase) } : node));
        setGraphFeedback({ status: "success", message: `Changed ${phase.id} to ${nextKind}.` });
      },
    });
  };
  const changeTransition = (kind: "fixed" | "quadrant-plurality", trigger: HTMLSelectElement) => {
    if (!draft || !selectedId) return;
    const phase = draft.project.scenario.phases.find((item) => item.id === selectedId);
    if (!phase || (phase.kind !== "position-question" && phase.kind !== "video-position-question") || phase.next.type === kind) return;
    const currentLabel = phase.next.type === "fixed" ? "fixed target" : "quadrant plurality";
    const nextLabel = kind === "fixed" ? "fixed target" : "quadrant plurality";
    setConfirmation({
      title: `Change “${phase.id}” to ${nextLabel}?`,
      description: `This replaces its ${currentLabel} outcome connections with ${nextLabel} connections. You can undo this change during this editing session.`,
      confirmLabel: "Replace connections",
      cancelLabel: "Keep current rule",
      tone: "primary",
      trigger,
      onConfirm: () => {
        const fixed = { type: "fixed" as const, target: "idle" };
        const pluralityMap = phase.field.type === "two-quadrant"
          ? { min: "idle", max: "idle" }
          : phase.field.type === "polygon-zones"
            ? Object.fromEntries(phase.field.zones.map((zone) => [zone.id, "idle"]))
            : { q1: "idle", q2: "idle", q3: "idle", q4: "idle" };
        const nextPhase = {
          ...phase,
          next: kind === "fixed" ? fixed : { type: "quadrant-plurality", map: pluralityMap, tie: "idle", empty: "idle", countedStatuses: ["valid", "stale", "disconnected"] },
        } as Phase;
        const retained = edges.filter((edge) => edge.source !== selectedId);
        const handles = phaseOutputHandles(nextPhase);
        const nextEdges = [...retained, ...handles.map((handle) => ({ id: `${selectedId}:${handle}`, source: selectedId, sourceHandle: handle, target: END_NODE_ID }))];
        const phases = draft.project.scenario.phases.map((item) => item.id === selectedId ? nextPhase : item) as Draft["project"]["scenario"]["phases"];
        record({ ...draft, project: { ...draft.project, scenario: { ...draft.project.scenario, phases } }, document: { ...draft.document, edges: nextEdges }, updatedAt: Date.now() }, nextEdges);
        setNodes((current) => current.map((node) => node.id === selectedId ? { ...node, data: nodeDataForPhase(nextPhase) } : node));
      },
    });
  };

  const changeQuestionLayout = (layout: "four-quadrant" | "two-quadrant-x" | "two-quadrant-y" | "three-candidate-zones", trigger: HTMLSelectElement) => {
    if (!draft || !selectedId) return;
    const phase = draft.project.scenario.phases.find((item) => item.id === selectedId);
    if (!phase || (phase.kind !== "position-question" && phase.kind !== "video-position-question")) return;
    const currentLayout = phase.field.type === "four-quadrant"
      ? "four-quadrant"
      : phase.field.type === "two-quadrant"
        ? `two-quadrant-${phase.field.axis}`
        : "three-candidate-zones";
    if (currentLayout === layout) return;
    const applyChange = () => {
      const field = layout === "four-quadrant"
      ? {
          type: "four-quadrant" as const,
          xAxis: phase.field.type === "two-quadrant" && phase.field.axis === "x" ? phase.field.labels : { minLabel: "Left", maxLabel: "Right" },
          yAxis: phase.field.type === "two-quadrant" && phase.field.axis === "y" ? phase.field.labels : { minLabel: "Top", maxLabel: "Bottom" },
          ...(phase.field.type !== "polygon-zones" && phase.field.arena ? { arena: phase.field.arena } : {}),
        }
      : layout === "three-candidate-zones"
        ? {
            type: "polygon-zones" as const,
            zones: [
              { id: "candidate-1", label: "Candidate 1", points: [{ x: 0, y: 0 }, { x: 0.3, y: 0 }, { x: 0.3, y: 1 }, { x: 0, y: 1 }] },
              { id: "candidate-2", label: "Candidate 2", points: [{ x: 0.35, y: 0 }, { x: 0.65, y: 0 }, { x: 0.65, y: 1 }, { x: 0.35, y: 1 }] },
              { id: "candidate-3", label: "Candidate 3", points: [{ x: 0.7, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0.7, y: 1 }] },
            ],
          }
        : {
          type: "two-quadrant" as const,
          axis: layout === "two-quadrant-x" ? "x" as const : "y" as const,
          labels: phase.field.type === "four-quadrant"
            ? layout === "two-quadrant-x" ? phase.field.xAxis : phase.field.yAxis
            : phase.field.type === "two-quadrant"
              ? phase.field.labels
              : { minLabel: "Min", maxLabel: "Max" },
          ...(phase.field.type !== "polygon-zones" && phase.field.arena ? { arena: phase.field.arena } : {}),
        };
      const next = phase.next.type === "fixed" ? phase.next : {
        ...phase.next,
        map: field.type === "two-quadrant"
          ? { min: "idle", max: "idle" }
          : field.type === "polygon-zones"
            ? Object.fromEntries(field.zones.map((zone) => [zone.id, "idle"]))
            : { q1: "idle", q2: "idle", q3: "idle", q4: "idle" },
      };
      const nextPhase = { ...phase, field, next } as Phase;
      const nextEdges = next.type === "quadrant-plurality"
        ? replacePluralityLayoutEdges(edges, nextPhase as Extract<Phase, { kind: "position-question" | "video-position-question" }>)
        : edges;
      const phases = draft.project.scenario.phases.map((item) => item.id === selectedId ? nextPhase : item) as Draft["project"]["scenario"]["phases"];
      record({ ...draft, project: { ...draft.project, scenario: { ...draft.project.scenario, phases } }, document: { ...draft.document, edges: nextEdges }, updatedAt: Date.now() }, nextEdges);
      setNodes((current) => current.map((node) => node.id === selectedId ? { ...node, data: nodeDataForPhase(nextPhase) } : node));
    };
    if (phase.next.type !== "quadrant-plurality") {
      applyChange();
      return;
    }
    const layoutLabel = layout === "four-quadrant" ? "four quadrants" : layout === "two-quadrant-x" ? "left / right quadrants" : "top / bottom quadrants";
    setConfirmation({
      title: `Change “${phase.id}” to ${layoutLabel}?`,
      description: "This replaces the question’s outcome connections for the new layout. You can undo this change during this editing session.",
      confirmLabel: "Replace connections",
      cancelLabel: "Keep current layout",
      tone: "primary",
      trigger,
      onConfirm: applyChange,
    });
  };

  if (!draft) return <main className="home" data-sc-tool-density="compact" data-sc-tool-root>
    <header className="home-heading"><p className="sc-tool-eyebrow">Authoring workspace</p><h1 ref={homeHeadingRef} tabIndex={-1}>Show Studio</h1><p className="sc-tool-copy lede">Create and safely round-trip Smartphonecracy shows.</p></header>
    <div className="home-actions">
      <button className="sc-tool-button" data-sc-tool-variant="primary" onClick={createShow}>New show</button>
      <button className="sc-tool-button" data-sc-tool-variant="secondary" onClick={() => void importLatestProduction()}>New from active production</button>
      <button className="sc-tool-button" data-sc-tool-variant="secondary" type="button" aria-describedby={importFeedback ? "studio-home-feedback" : undefined} onClick={() => importInputRef.current?.click()}>Import show or backup</button>
      <button className="sc-tool-button" data-sc-tool-variant="secondary" type="button" onClick={openMediaLibrary}>Media library</button>
      <input ref={importInputRef} aria-label="Import show or backup" hidden multiple type="file" accept="application/json,text/plain,.json,.txt" onChange={(event) => {
        void importFiles(event.currentTarget.files);
        event.currentTarget.value = "";
      }} />
    </div>
    {productionImportOpen && <div className="sc-tool-panel publish-panel" role="dialog" aria-labelledby="production-import-heading">
      <p className="sc-tool-eyebrow" id="production-import-heading">Import active production</p>
      {operatorEmail === null ? <>
        <p className="sc-tool-help">Sign in as an operator to read the latest active published show. Production is never modified by this action.</p>
        <form onSubmit={(event) => void signIn(event)}>
          <label className="sc-tool-label">Operator email<input className="sc-tool-field" type="email" autoComplete="username" value={signInForm.email} onChange={(event) => setSignInForm((form) => ({ ...form, email: event.target.value }))} /></label>
          <label className="sc-tool-label">Password<input className="sc-tool-field" type="password" autoComplete="current-password" value={signInForm.password} onChange={(event) => setSignInForm((form) => ({ ...form, password: event.target.value }))} /></label>
          <div className="publish-panel-actions"><button className="sc-tool-button" type="button" onClick={() => setProductionImportOpen(false)}>Cancel</button><button className="sc-tool-button" data-sc-tool-variant="primary" type="submit" disabled={signingIn}>{signingIn ? "Signing in…" : "Sign in"}</button></div>
        </form>
        {signInFeedback && <Feedback id="production-signin-feedback" feedback={signInFeedback} />}
      </> : <><p className="sc-tool-help">Signed in as {operatorEmail}. The active production record will be copied into a new immutable-baseline draft.</p><div className="publish-panel-actions"><button className="sc-tool-button" type="button" onClick={() => setProductionImportOpen(false)}>Cancel</button><button className="sc-tool-button" data-sc-tool-variant="primary" type="button" onClick={() => void importLatestProduction()}>Create production fork</button></div></>}
    </div>}
    {importFeedback && <Feedback id="studio-home-feedback" feedback={importFeedback} />}
    <h2>Recent drafts</h2>{recent.length === 0 && <p className="sc-tool-copy lede">No local drafts yet. Import scenario.json and media-manifest.json together.</p>}
    {localManifest && <p className="sc-tool-copy lede">Media library: {localManifest.files.length} file{localManifest.files.length === 1 ? "" : "s"} available.</p>}
    {recent.map((item) => <article key={item.id}><button className="sc-tool-button draft-open" data-sc-tool-variant="quiet" onClick={() => void recoverDraft(db, item.id).then((recovered) => setDraft(recovered && localManifest ? refreshDraftLocalMedia(recovered, localManifest) : recovered))}>{item.name}</button><small className="sc-tool-copy sc-tool-mono">{new Date(item.updatedAt).toLocaleString()}</small><button className="sc-tool-button" data-sc-tool-variant="secondary" onClick={() => duplicate(item)}>Duplicate</button><button className="sc-tool-button" data-sc-tool-variant="secondary" onClick={() => download(`${item.name}.studio-backup.json`, exportBackup(item))}>Export backup</button><button className="sc-tool-button" data-sc-tool-variant="danger" onClick={(event) => remove(item, event.currentTarget)}>Delete</button></article>)}
    {mediaLibraryOpen && <MediaLibraryDialog manifest={localManifest} project={undefined} feedback={importFeedback} uploading={mediaUploading} onUpload={addMedia} onDelete={requestMediaRemoval} onClose={() => setMediaLibraryOpen(false)} />}
    {confirmation && <ConfirmationDialog details={confirmation} onClose={closeConfirmation} />}
  </main>;

  const currentDiagnostics = diagnostics(draft.project);
  const invalidNodeIds = new Set(currentDiagnostics.filter((item) => item.severity === "error" && item.phaseId).map((item) => item.phaseId));
  const visibleNodes = nodes.map((node) => invalidNodeIds.has(node.id)
    ? { ...node, className: [node.className, "invalid"].filter(Boolean).join(" ") }
    : node);
  const blocked = exportBlocked(currentDiagnostics, acknowledged);
  const exportDeployment = () => {
    setExportFeedback(undefined);
    try {
      const deployment = assembleDeploymentPackage(draft, acknowledged, { generatedAt: new Date().toISOString(), studioBuild: "0.0.1" });
      for (const [name, value] of Object.entries(deployment.files)) {
        if (name === "README.txt") {
          const url = URL.createObjectURL(new Blob([value as string], { type: "text/plain" }));
          const link = Object.assign(document.createElement("a"), { href: url, download: `${deployment.packageName}-${name}` });
          link.click(); URL.revokeObjectURL(url);
        } else download(`${deployment.packageName}-${name}`, value);
      }
      setExportFeedback({ status: "success", message: `Exported deployment package for “${draft.name}”.` });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "The package could not be assembled.";
      setExportFeedback({ status: "danger", message: `Deployment export failed: ${detail} Review Diagnostics, resolve the reported issues, and try again.` });
    }
  };
  const openPublish = () => {
    setPublishFeedback(undefined);
    setSignInFeedback(undefined);
    setPublishForm({
      showId: draft.document.productionBaseline?.showId ?? draft.id,
      name: draft.document.productionBaseline?.name ?? draft.name,
    });
    setPublishOpen(true);
  };
  const publishDraft = async (event: FormEvent) => {
    event.preventDefault();
    if (!operatorPb.authStore.isValid) return;
    setPublishing(true);
    setPublishFeedback(undefined);
    try {
      const artifacts = exportArtifacts(draft);
      // Relative fetch: only resolves when Studio is served from apps/server
      // alongside /api/admin (same as the "Admin" link) -- publishing
      // from the standalone `vite dev` Studio server isn't supported.
      const response = await fetch("/api/admin/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${operatorPb.authStore.token}` },
        body: JSON.stringify({
          showId: publishForm.showId,
          name: publishForm.name,
          scenario: artifacts["scenario.json"],
          mediaManifest: artifacts["media-manifest.json"],
          ...(draft.document.productionBaseline === undefined
            ? {}
            : { baseRecordId: draft.document.productionBaseline.recordId }),
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error === "stale_production_baseline"
          ? "Production changed after this draft was created. Import the latest production show and reapply the campaign changes before publishing."
          : body?.error === "invalid_publish_request"
          ? "Show ID must be letters, numbers, - or _ only, and Name can't be empty."
          : `Publish failed (${response.status}).`);
      }
      setPublishFeedback({ status: "success", message: `Published "${publishForm.name}". It goes live automatically within moments -- pick it in /admin's Active show panel first if another show is currently pinned as active.` });
    } catch (error) {
      setPublishFeedback({
        status: "danger",
        message: error instanceof Error && error.message !== "" ? error.message : "Publish failed.",
      });
    } finally {
      setPublishing(false);
    }
  };
  const saveLayout = (positionedNodes = nodes) => saveCanvas(draft, positionedNodes, edges);
  const saveMovedNodes = (movedNodes: Node[]) => {
    const movedPositions = new Map(movedNodes.map((node) => [node.id, node.position]));
    saveLayout(nodes.map((node) => {
      const position = movedPositions.get(node.id);
      return position ? { ...node, position } : node;
    }));
  };
  const mediaPickerPhase = mediaPicker
    ? draft.project.scenario.phases.find((phase) => phase.id === mediaPicker.phaseId)
    : undefined;
  const mediaPickerSelectedSrc = mediaPickerPhase?.kind === "video" || mediaPickerPhase?.kind === "video-position-question"
    ? mediaPicker?.target === "audioSrc" ? mediaPickerPhase.audioSrc ?? "" : mediaPickerPhase.src
    : "";
  const selectedPhase = draft.project.scenario.phases.find((phase) => phase.id === selectedId);
  const preparePreviewFromSelected = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (!selectedPhase) return;
    try {
      const token = storeProjectPreview(draft.name, draft.project, selectedPhase.id);
      event.currentTarget.href = projectPreviewUrl(token);
    } catch (error) {
      event.preventDefault();
      setGraphFeedback({ status: "danger", message: `Preview could not be opened: ${error instanceof Error ? error.message : "The browser could not prepare the preview."}` });
    }
  };
  return <main ref={editorRef} tabIndex={-1} className={`editor${showInspector ? "" : " no-inspector"}${showDiagnostics ? "" : " no-diagnostics"}`} data-sc-tool-density="compact" data-sc-tool-root>
    <header className="menubar">
      <Menu label="File" items={[
        { label: "New show", onSelect: createShow },
        { label: "New from active production", onSelect: () => void importLatestProduction() },
        { label: "Import…", onSelect: () => importInputRef.current?.click() },
        { label: "Media library…", onSelect: openMediaLibrary },
        { label: "Duplicate", onSelect: () => duplicate(draft) },
        { separator: true },
        { label: "Export files", onSelect: () => Object.entries(exportArtifacts(draft)).forEach(([name, value]) => download(name, value)), disabled: blocked },
        { label: "Export for deployment", onSelect: exportDeployment, disabled: blocked },
        { label: "Publish to PocketBase…", onSelect: openPublish, disabled: blocked },
        { label: "Save backup", onSelect: () => download(`${draft.name}.studio-backup.json`, exportBackup(draft)) },
        { separator: true },
        { label: "Close show", onSelect: closeShow },
      ]} />
      <Menu label="Edit" items={[
        { label: "Undo", onSelect: () => { if (history.current) applyHistory(history.current.undo()); }, disabled: !history.current?.canUndo },
        { label: "Redo", onSelect: () => { if (history.current) applyHistory(history.current.redo()); }, disabled: !history.current?.canRedo },
      ]} />
      <Menu label="Add" items={[
        { label: "Campaign + election sections 3–5", onSelect: () => addCampaignExtension(), disabled: !draft.document.productionBaseline },
        { separator: true },
        { label: "Video phase", onSelect: () => addPhase("video") },
        { label: "Image + MP3 phase", onSelect: () => addPhase("image-audio") },
        { label: "Position question", onSelect: () => addPhase("position-question") },
        { label: "Video + position vote", onSelect: () => addPhase("video-position-question") },
        { label: "Image + MP3 + position vote", onSelect: () => addPhase("image-audio-position-question") },
      ]} />
      <Menu label="View" items={[
        { label: showInspector ? "Hide properties" : "Show properties", onSelect: () => setShowInspector((value) => !value) },
        { label: showDiagnostics ? "Collapse bottom panel" : "Expand bottom panel", onSelect: () => setShowDiagnostics((value) => !value) },
        { separator: true },
        { label: "Save layout", onSelect: saveLayout },
      ]} />
      <button className="sc-tool-button" data-sc-tool-variant="secondary" type="button" onClick={openMediaLibrary}>Media</button>
      <input aria-label="Show name" className="sc-tool-field show-name" value={draft.name} onChange={(event) => saveCanvas({ ...draft, name: event.target.value })} />
      <SaveStatus status={status} />
      {selectedPhase && <a className="sc-tool-button" data-sc-tool-variant="primary" href="preview.html" target="_blank" rel="noreferrer" onClick={preparePreviewFromSelected}>Preview from here</a>}
      <a className="sc-tool-button" data-sc-tool-variant="secondary" href="/display/" target="_blank" rel="noreferrer">Display</a>
      <a className="sc-tool-button" data-sc-tool-variant="secondary" href="/admin/" target="_blank" rel="noreferrer">Admin</a>
      <input ref={importInputRef} aria-label="Import show or backup" hidden multiple type="file" accept="application/json,text/plain,.json,.txt" onChange={(event) => {
        void importFiles(event.currentTarget.files);
        event.currentTarget.value = "";
      }} />
      {importFeedback && <Feedback id="studio-import-feedback" className="menubar-feedback" feedback={importFeedback} />}
      {exportFeedback && <Feedback id="studio-export-feedback" className="menubar-feedback" feedback={exportFeedback} />}
      {publishOpen && <div className="sc-tool-panel publish-panel" role="dialog" aria-labelledby="publish-heading">
        <p className="sc-tool-eyebrow" id="publish-heading">Publish to PocketBase</p>
        {operatorEmail === null ? <>
          <p className="sc-tool-help">Sign in with your operator credentials (the same ones used for /admin). Stays signed in on this device for 30 days.</p>
          <form onSubmit={(event) => void signIn(event)}>
            <label className="sc-tool-label" htmlFor="publish-email">Operator email
              <input id="publish-email" className="sc-tool-field" type="email" autoComplete="username" value={signInForm.email} onChange={(event) => setSignInForm((form) => ({ ...form, email: event.target.value }))} />
            </label>
            <label className="sc-tool-label" htmlFor="publish-password">Password
              <input id="publish-password" className="sc-tool-field sc-tool-mono" type="password" autoComplete="current-password" value={signInForm.password} onChange={(event) => setSignInForm((form) => ({ ...form, password: event.target.value }))} />
            </label>
            <div className="publish-panel-actions">
              <button className="sc-tool-button" data-sc-tool-variant="secondary" type="button" onClick={() => setPublishOpen(false)}>Cancel</button>
              <button className="sc-tool-button" data-sc-tool-variant="primary" type="submit" disabled={signingIn || !signInForm.email || !signInForm.password}>{signingIn ? "Signing in…" : "Sign in"}</button>
            </div>
          </form>
          {signInFeedback && <Feedback id="studio-signin-feedback" className="menubar-feedback" feedback={signInFeedback} />}
        </> : <>
          <p className="sc-tool-help">Signed in as {operatorEmail}. Publishing only works when Studio is served from apps/server. <button className="sc-tool-button" data-sc-tool-variant="quiet" type="button" onClick={signOut}>Sign out</button></p>
          <form onSubmit={(event) => void publishDraft(event)}>
            <label className="sc-tool-label" htmlFor="publish-show-id">Show ID
              <input id="publish-show-id" className="sc-tool-field sc-tool-mono" value={publishForm.showId} onChange={(event) => setPublishForm((form) => ({ ...form, showId: event.target.value }))} />
            </label>
            <label className="sc-tool-label" htmlFor="publish-name">Name
              <input id="publish-name" className="sc-tool-field" value={publishForm.name} onChange={(event) => setPublishForm((form) => ({ ...form, name: event.target.value }))} />
            </label>
            <div className="publish-panel-actions">
              <button className="sc-tool-button" data-sc-tool-variant="secondary" type="button" onClick={() => setPublishOpen(false)}>Cancel</button>
              <button className="sc-tool-button" data-sc-tool-variant="primary" type="submit" disabled={publishing || !publishForm.showId || !publishForm.name}>{publishing ? "Publishing…" : "Publish"}</button>
            </div>
          </form>
          {publishFeedback && <Feedback id="studio-publish-feedback" className="menubar-feedback" feedback={publishFeedback} />}
        </>}
      </div>}
      {productionImportOpen && <div className="sc-tool-panel publish-panel" role="dialog" aria-labelledby="editor-production-import-heading">
        <p className="sc-tool-eyebrow" id="editor-production-import-heading">Import active production</p>
        {operatorEmail === null ? <>
          <p className="sc-tool-help">Sign in as an operator. This creates a new draft and does not modify production.</p>
          <form onSubmit={(event) => void signIn(event)}>
            <label className="sc-tool-label">Operator email<input className="sc-tool-field" type="email" autoComplete="username" value={signInForm.email} onChange={(event) => setSignInForm((form) => ({ ...form, email: event.target.value }))} /></label>
            <label className="sc-tool-label">Password<input className="sc-tool-field" type="password" autoComplete="current-password" value={signInForm.password} onChange={(event) => setSignInForm((form) => ({ ...form, password: event.target.value }))} /></label>
            <div className="publish-panel-actions"><button className="sc-tool-button" type="button" onClick={() => setProductionImportOpen(false)}>Cancel</button><button className="sc-tool-button" data-sc-tool-variant="primary" type="submit" disabled={signingIn}>{signingIn ? "Signing in…" : "Sign in"}</button></div>
          </form>
          {signInFeedback && <Feedback id="editor-production-signin-feedback" feedback={signInFeedback} />}
        </> : <><p className="sc-tool-help">Signed in as {operatorEmail}. Replace the open draft with a new fork of the active production show?</p><div className="publish-panel-actions"><button className="sc-tool-button" type="button" onClick={() => setProductionImportOpen(false)}>Cancel</button><button className="sc-tool-button" data-sc-tool-variant="primary" type="button" onClick={() => void importLatestProduction()}>Create production fork</button></div></>}
      </div>}
    </header>
    <section aria-label="Scenario graph" className="canvas sc-tool-graph-canvas">{graphFeedback && <Feedback id="studio-graph-feedback" className="canvas-feedback" feedback={graphFeedback} />}<ReactFlow nodes={visibleNodes} edges={edges} nodeTypes={nodeTypes} onNodeClick={(_, node) => { setSelectedId(node.id); setShowInspector(true); }} onNodeDragStop={(_, node, movedNodes) => saveMovedNodes([...movedNodes, node])} onSelectionDragStop={(_, movedNodes) => saveMovedNodes(movedNodes)} onConnect={connect} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onEdgesDelete={(deleted) => { const ids = new Set(deleted.map((edge) => edge.id)); const next = edges.filter((edge) => !ids.has(edge.id)); setEdges(next); persistGraph(next); }} onNodesDelete={(deleted) => { const removed = new Set(deleted.map((node) => node.id)); const nextNodes = nodes.filter((node) => !removed.has(node.id)); const nodeIds = new Set(nextNodes.map((node) => node.id)); const nextEdges = pruneEdges(edges, nodeIds); setEdges(nextEdges); const phases = draft.project.scenario.phases.filter((phase) => !removed.has(phase.id)) as Draft["project"]["scenario"]["phases"]; saveCanvas({ ...draft, project: { ...draft.project, scenario: { ...draft.project.scenario, phases } } }, nextNodes, nextEdges); }} defaultViewport={draft.document.viewport} onMoveEnd={(event, viewport) => { if (event) saveCanvas({ ...draft, document: { ...draft.document, viewport } }); }}><Background /></ReactFlow></section>
    <Inspector project={draft.project} selectedId={selectedId} localMedia={localManifest?.files ?? []} onRename={renameSelected} onChange={updatePhase} onChooseMedia={openMediaPicker} onComponentTypeChange={changeSelectedComponentType} onTransitionChange={changeTransition} onQuestionLayoutChange={changeQuestionLayout} onTargetAudienceSizeChange={updateTargetAudienceSize} />
    <DiagnosticsPanel project={draft.project} acknowledged={acknowledged} collapsed={!showDiagnostics} onToggle={() => setShowDiagnostics((value) => !value)} onAcknowledge={(key) => setAcknowledged((current) => { const next = new Set(current); next.has(key) ? next.delete(key) : next.add(key); return next; })} onFocus={(id) => { setSelectedId(id); setShowInspector(true); }} />
    {mediaLibraryOpen && <MediaLibraryDialog manifest={localManifest} project={draft.project} feedback={importFeedback} uploading={mediaUploading} onUpload={addMedia} onDelete={requestMediaRemoval} onClose={() => setMediaLibraryOpen(false)} />}
    {mediaPicker && <MediaLibraryDialog manifest={localManifest} project={draft.project} feedback={importFeedback} uploading={mediaUploading} selection={{ contextLabel: `${mediaPicker.mediaKind} for ${mediaPicker.phaseId}`, selectedSrc: mediaPickerSelectedSrc, mediaKind: mediaPicker.mediaKind, onSelect: selectMedia }} onUpload={addMedia} onDelete={requestMediaRemoval} onClose={closeMediaPicker} />}
    {confirmation && <ConfirmationDialog details={confirmation} onClose={closeConfirmation} />}
  </main>;
}
