import { useEffect, useMemo, useRef, useState } from "react";
import { addEdge, Background, ReactFlow, type Connection, type Edge, type Node, useEdgesState, useNodesState } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Autosave, IndexedDbDraftDatabase, recoverDraft, type SaveStatus } from "./drafts.js";
import { exportArtifacts, exportBackup, importBackup, importRuntime } from "./io.js";
import type { Draft } from "./model.js";
import { applyEdges, END_NODE_ID, ENTRY_NODE_ID, graphEdges, graphPhases, phaseOutputHandles, pruneEdges, replacePluralityLayoutEdges, validateConnection, withoutOutputEdge } from "./canvas/graph.js";
import { nodeDataForPhase, nodeTypes } from "./canvas/nodes.js";
import { changePhaseKind, renamePhase, type AuthorablePhaseKind, type Phase } from "./inspector/model.js";
import { Inspector } from "./inspector/Inspector.js";
import { SessionHistory } from "./inspector/history.js";
import { DiagnosticsPanel } from "./diagnostics/DiagnosticsPanel.js";
import { diagnostics, exportBlocked } from "./diagnostics/diagnostics.js";
import { PreviewPanel } from "./preview/PreviewPanel.js";
import { assembleDeploymentPackage } from "./export/deployment.js";
import { Menu } from "./chrome/Menu.js";
import { loadLocalMediaManifest, refreshDraftLocalMedia, runtimeMediaManifest, type MediaManifest } from "./media/local.js";
import "@smartphonecracy/tool-ui/styles.css";
import "./style.css";

const download = (name: string, value: unknown) => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: name });
  link.click();
  URL.revokeObjectURL(url);
};

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
      ariaLabel: `${phase.kind === "position-question" ? "Question" : phase.kind} phase: ${data.label}`,
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
  const db = useMemo(() => new IndexedDbDraftDatabase(), []);
  const autosave = useMemo(() => new Autosave(db), [db]);
  const [recent, setRecent] = useState<Draft[]>([]);
  const [draft, setDraft] = useState<Draft>();
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set());
  const [previewing, setPreviewing] = useState(false);
  const [showInspector, setShowInspector] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(true);
  const [localManifest, setLocalManifest] = useState<MediaManifest>();
  const importInputRef = useRef<HTMLInputElement>(null);
  type HistoryState = { draft: Draft; edges: Edge[] };
  const history = useRef<SessionHistory<HistoryState>>();

  useEffect(() => void db.list().then(setRecent), [db]);
  useEffect(() => {
    void loadLocalMediaManifest().then((manifest) => {
      if (manifest) setLocalManifest(manifest);
    });
  }, []);
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
  const readJson = (file: File) => file.text().then(JSON.parse);
  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const parsed = await Promise.all([...files].map(readJson));
      const imported = files.length === 1 ? importBackup(parsed[0]) : importRuntime(parsed[0], parsed[1]);
      history.current = undefined;
      save(imported);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Import failed");
    }
  };
  const duplicate = (source: Draft) => save({ ...structuredClone(source), id: crypto.randomUUID(), name: `${source.name} copy`, updatedAt: Date.now() });
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
  const remove = async (source: Draft) => {
    if (!confirm(`Delete “${source.name}”?`)) return;
    await db.delete(source.id);
    if (draft?.id === source.id) setDraft(undefined);
    setRecent(await db.list());
  };
  const closeShow = () => {
    setDraft(undefined);
    setNodes([]);
    setEdges([]);
    setSelectedId(undefined);
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
    if (problem) return void alert(problem);
    const next = addEdge({ ...connection, id: `${connection.source}:${sourceHandle}` }, retained);
    setEdges(next);
    persistGraph(next);
  };
  const addPhase = (kind: "idle" | "video" | "position-question") => {
    if (!draft) return;
    if (kind === "idle" && draft.project.scenario.phases.some((phase) => phase.kind === "idle")) return void alert("A show already has its idle phase.");
    const id = kind === "idle" ? "idle" : `${kind}-${crypto.randomUUID().slice(0, 6)}`;
    const phase = kind === "idle" ? { kind, id: "idle" as const } : kind === "video"
      ? { kind, id, src: "media/new-video.mp4", expectedDurationMs: 1000, next: "idle" }
      : { kind, id, text: "New position question", field: { type: "four-quadrant" as const, xAxis: { minLabel: "Left", maxLabel: "Right" }, yAxis: { minLabel: "Top", maxLabel: "Bottom" } }, durationMs: 60000, freezeMs: 5000, connectionStaleAfterMs: 10000, showLiveCounts: true, next: { type: "quadrant-plurality" as const, map: { q1: "idle", q2: "idle", q3: "idle", q4: "idle" }, tie: "idle", empty: "idle", countedStatuses: ["valid", "stale", "disconnected"] as const } };
    const phases = [...draft.project.scenario.phases, phase] as Draft["project"]["scenario"]["phases"];
    const nextNodes = [...nodes, { id, type: "phase", position: { x: 400, y: 200 }, data: nodeDataForPhase(phase as Phase) }];
    const handles = kind === "position-question" ? ["q1", "q2", "q3", "q4", "tie", "empty"] : kind === "video" ? ["next"] : [];
    const nextEdges = [...edges, ...handles.map((handle) => ({ id: `${id}:${handle}`, source: id, sourceHandle: handle, target: END_NODE_ID }))];
    setNodes(nextNodes);
    setEdges(nextEdges);
    saveCanvas({ ...draft, project: { ...draft.project, scenario: { ...draft.project.scenario, phases } } }, nextNodes, nextEdges);
  };
  const updatePhase = (nextPhase: Phase) => {
    if (!draft) return;
    const phases = draft.project.scenario.phases.map((phase) => phase.id === nextPhase.id ? nextPhase : phase) as Draft["project"]["scenario"]["phases"];
    record({ ...draft, project: { ...draft.project, scenario: { ...draft.project.scenario, phases } }, updatedAt: Date.now() });
    setNodes((current) => current.map((node) => node.id === nextPhase.id ? { ...node, data: nodeDataForPhase(nextPhase) } : node));
  };
  const renameSelected = (nextId: string) => {
    if (!draft || !selectedId) return;
    const project = renamePhase(draft.project, selectedId, nextId);
    const nextEdges = edges.map((edge) => ({ ...edge, id: edge.id.replace(`${selectedId}:`, `${nextId}:`), source: edge.source === selectedId ? nextId : edge.source, target: edge.target === selectedId ? nextId : edge.target }));
    record({ ...draft, project, document: { ...draft.document, nodes: draft.document.nodes.map((node) => node.id === selectedId ? { ...node, id: nextId } : node), edges: nextEdges }, updatedAt: Date.now() }, nextEdges);
    setNodes((current) => current.map((node) => node.id === selectedId ? { ...node, id: nextId, data: { ...node.data, label: nextId } } : node));
    setSelectedId(nextId);
  };
  const changeSelectedKind = (kind: AuthorablePhaseKind) => {
    if (!draft || !selectedId) return;
    const phase = draft.project.scenario.phases.find((item) => item.id === selectedId);
    if (!phase || phase.kind === kind) return;
    if (!confirm("Changing phase type replaces its fields and connections. You can undo this change.")) return;
    const nextPhase = changePhaseKind(phase, kind);
    const retained = edges.filter((edge) => edge.source !== selectedId);
    const nextEdges = [
      ...retained,
      ...phaseOutputHandles(nextPhase).map((handle) => ({ id: `${nextPhase.id}:${handle}`, source: nextPhase.id, sourceHandle: handle, target: END_NODE_ID })),
    ];
    const phases = draft.project.scenario.phases.map((item) => item.id === selectedId ? nextPhase : item) as Draft["project"]["scenario"]["phases"];
    record({ ...draft, project: { ...draft.project, scenario: { ...draft.project.scenario, phases } }, document: { ...draft.document, edges: nextEdges }, updatedAt: Date.now() }, nextEdges);
    setNodes((current) => current.map((node) => node.id === selectedId ? { ...node, data: nodeDataForPhase(nextPhase) } : node));
  };
  const changeTransition = (kind: "fixed" | "quadrant-plurality") => {
    if (!draft || !selectedId) return;
    const phase = draft.project.scenario.phases.find((item) => item.id === selectedId);
    if (!phase || phase.kind !== "position-question" || phase.next.type === kind) return;
    if (!confirm("Changing the transition rule replaces this phase’s connections. You can undo this change.")) return;
    const fixed = { type: "fixed" as const, target: "idle" };
    const nextPhase = (phase.field.type === "two-quadrant"
      ? { ...phase, next: kind === "fixed" ? fixed : { type: "quadrant-plurality", map: { min: "idle", max: "idle" }, tie: "idle", empty: "idle", countedStatuses: ["valid", "stale", "disconnected"] } }
      : { ...phase, next: kind === "fixed" ? fixed : { type: "quadrant-plurality", map: { q1: "idle", q2: "idle", q3: "idle", q4: "idle" }, tie: "idle", empty: "idle", countedStatuses: ["valid", "stale", "disconnected"] } }) as Phase;
    const retained = edges.filter((edge) => edge.source !== selectedId);
    const handles = kind === "fixed" ? ["next"] : phase.field.type === "two-quadrant" ? ["min", "max", "tie", "empty"] : ["q1", "q2", "q3", "q4", "tie", "empty"];
    const nextEdges = [...retained, ...handles.map((handle) => ({ id: `${selectedId}:${handle}`, source: selectedId, sourceHandle: handle, target: END_NODE_ID }))];
    const phases = draft.project.scenario.phases.map((item) => item.id === selectedId ? nextPhase : item) as Draft["project"]["scenario"]["phases"];
    record({ ...draft, project: { ...draft.project, scenario: { ...draft.project.scenario, phases } }, document: { ...draft.document, edges: nextEdges }, updatedAt: Date.now() }, nextEdges);
    setNodes((current) => current.map((node) => node.id === selectedId ? { ...node, data: nodeDataForPhase(nextPhase) } : node));
  };

  const changeQuestionLayout = (layout: "four-quadrant" | "two-quadrant-x" | "two-quadrant-y") => {
    if (!draft || !selectedId) return;
    const phase = draft.project.scenario.phases.find((item) => item.id === selectedId);
    if (!phase || phase.kind !== "position-question") return;
    const currentLayout = phase.field.type === "four-quadrant" ? "four-quadrant" : `two-quadrant-${phase.field.axis}`;
    if (currentLayout === layout) return;
    if (phase.next.type === "quadrant-plurality" && !confirm("Changing the quadrant layout replaces this question’s outcome connections. You can undo this change.")) return;
    const field = layout === "four-quadrant"
      ? {
          type: "four-quadrant" as const,
          xAxis: phase.field.type === "two-quadrant" && phase.field.axis === "x" ? phase.field.labels : { minLabel: "Left", maxLabel: "Right" },
          yAxis: phase.field.type === "two-quadrant" && phase.field.axis === "y" ? phase.field.labels : { minLabel: "Top", maxLabel: "Bottom" },
        }
      : {
          type: "two-quadrant" as const,
          axis: layout === "two-quadrant-x" ? "x" as const : "y" as const,
          labels: phase.field.type === "four-quadrant"
            ? layout === "two-quadrant-x" ? phase.field.xAxis : phase.field.yAxis
            : phase.field.labels,
        };
    const next = phase.next.type === "fixed" ? phase.next : {
      ...phase.next,
      map: field.type === "two-quadrant"
        ? { min: "idle", max: "idle" }
        : { q1: "idle", q2: "idle", q3: "idle", q4: "idle" },
    };
    const nextPhase = { ...phase, field, next } as Phase;
    const nextEdges = next.type === "quadrant-plurality"
      ? replacePluralityLayoutEdges(edges, nextPhase as Extract<Phase, { kind: "position-question" }>)
      : edges;
    const phases = draft.project.scenario.phases.map((item) => item.id === selectedId ? nextPhase : item) as Draft["project"]["scenario"]["phases"];
    record({ ...draft, project: { ...draft.project, scenario: { ...draft.project.scenario, phases } }, document: { ...draft.document, edges: nextEdges }, updatedAt: Date.now() }, nextEdges);
    setNodes((current) => current.map((node) => node.id === selectedId ? { ...node, data: nodeDataForPhase(nextPhase) } : node));
  };

  if (!draft) return <main className="home" data-sc-tool-density="compact" data-sc-tool-root><header className="home-heading"><p className="eyebrow">Authoring workspace</p><h1>Show Studio</h1><p className="lede">Create and safely round-trip Smartphonecracy shows.</p></header>
    <div className="home-actions">
      <button onClick={createShow}>New show</button>
      <label className="button ghost">Import show or backup<input hidden multiple type="file" accept="application/json" onChange={(event) => void importFiles(event.target.files)} /></label>
    </div>
    <h2>Recent drafts</h2>{recent.length === 0 && <p className="lede">No local drafts yet. Import scenario.json and media-manifest.json together.</p>}
    {localManifest && <p className="lede">Local media: {localManifest.files.length} file{localManifest.files.length === 1 ? "" : "s"} found in content/media.</p>}
    {recent.map((item) => <article key={item.id}><button className="draft-open" onClick={() => void recoverDraft(db, item.id).then((recovered) => setDraft(recovered && localManifest ? refreshDraftLocalMedia(recovered, localManifest) : recovered))}>{item.name}</button><small>{new Date(item.updatedAt).toLocaleString()}</small><button className="ghost" onClick={() => duplicate(item)}>Duplicate</button><button className="ghost" onClick={() => download(`${item.name}.studio-backup.json`, exportBackup(item))}>Export backup</button><button className="ghost danger" onClick={() => void remove(item)}>Delete</button></article>)}</main>;

  const currentDiagnostics = diagnostics(draft.project);
  const invalidNodeIds = new Set(currentDiagnostics.filter((item) => item.severity === "error" && item.phaseId).map((item) => item.phaseId));
  const visibleNodes = nodes.map((node) => invalidNodeIds.has(node.id)
    ? { ...node, className: [node.className, "invalid"].filter(Boolean).join(" ") }
    : node);
  const blocked = exportBlocked(currentDiagnostics, acknowledged);
  const exportDeployment = () => {
    try {
      const deployment = assembleDeploymentPackage(draft, acknowledged, { generatedAt: new Date().toISOString(), studioBuild: "0.0.1" });
      for (const [name, value] of Object.entries(deployment.files)) {
        if (name === "README.txt") {
          const url = URL.createObjectURL(new Blob([value as string], { type: "text/plain" }));
          const link = Object.assign(document.createElement("a"), { href: url, download: `${deployment.packageName}-${name}` });
          link.click(); URL.revokeObjectURL(url);
        } else download(`${deployment.packageName}-${name}`, value);
      }
    } catch (error) { alert(error instanceof Error ? error.message : "Deployment export failed"); }
  };
  const saveLayout = (positionedNodes = nodes) => saveCanvas(draft, positionedNodes, edges);
  const saveMovedNodes = (movedNodes: Node[]) => {
    const movedPositions = new Map(movedNodes.map((node) => [node.id, node.position]));
    saveLayout(nodes.map((node) => {
      const position = movedPositions.get(node.id);
      return position ? { ...node, position } : node;
    }));
  };
  if (previewing) return <PreviewPanel project={draft.project} onClose={() => setPreviewing(false)} />;
  return <main className={`editor${showInspector ? "" : " no-inspector"}${showDiagnostics ? "" : " no-diagnostics"}`} data-sc-tool-density="compact" data-sc-tool-root>
    <header className="menubar">
      <Menu label="File" items={[
        { label: "New show", onSelect: createShow },
        { label: "Import…", onSelect: () => importInputRef.current?.click() },
        { label: "Duplicate", onSelect: () => duplicate(draft) },
        { separator: true },
        { label: "Export files", onSelect: () => Object.entries(exportArtifacts(draft)).forEach(([name, value]) => download(name, value)), disabled: blocked },
        { label: "Export for deployment", onSelect: exportDeployment, disabled: blocked },
        { label: "Save backup", onSelect: () => download(`${draft.name}.studio-backup.json`, exportBackup(draft)) },
        { separator: true },
        { label: "Close show", onSelect: closeShow },
      ]} />
      <Menu label="Edit" items={[
        { label: "Undo", onSelect: () => { if (history.current) applyHistory(history.current.undo()); }, disabled: !history.current?.canUndo },
        { label: "Redo", onSelect: () => { if (history.current) applyHistory(history.current.redo()); }, disabled: !history.current?.canRedo },
      ]} />
      <Menu label="Add" items={[
        { label: "Video phase", onSelect: () => addPhase("video") },
        { label: "Position question", onSelect: () => addPhase("position-question") },
      ]} />
      <Menu label="View" items={[
        { label: showInspector ? "Hide properties" : "Show properties", onSelect: () => setShowInspector((value) => !value) },
        { label: showDiagnostics ? "Hide diagnostics" : "Show diagnostics", onSelect: () => setShowDiagnostics((value) => !value) },
        { separator: true },
        { label: "Save layout", onSelect: saveLayout },
      ]} />
      <input aria-label="Show name" className="show-name" value={draft.name} onChange={(event) => saveCanvas({ ...draft, name: event.target.value })} />
      <span aria-live="polite" className={`status ${status}`} data-save-status={status}>{status}</span>
      <button className="ghost" onClick={() => setPreviewing(true)}>Preview</button>
      <button className="ghost export" aria-label="Export for deployment" disabled={blocked} title={blocked ? "Resolve errors and acknowledge warnings first" : undefined} onClick={exportDeployment}>Export</button>
      <input ref={importInputRef} hidden multiple type="file" accept="application/json" onChange={(event) => void importFiles(event.target.files)} />
    </header>
    <section aria-label="Scenario graph" className="canvas sc-tool-graph-canvas"><ReactFlow nodes={visibleNodes} edges={edges} nodeTypes={nodeTypes} onNodeClick={(_, node) => { setSelectedId(node.id); setShowInspector(true); }} onNodeDragStop={(_, node, movedNodes) => saveMovedNodes([...movedNodes, node])} onSelectionDragStop={(_, movedNodes) => saveMovedNodes(movedNodes)} onConnect={connect} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onEdgesDelete={(deleted) => { const ids = new Set(deleted.map((edge) => edge.id)); const next = edges.filter((edge) => !ids.has(edge.id)); setEdges(next); persistGraph(next); }} onNodesDelete={(deleted) => { const removed = new Set(deleted.map((node) => node.id)); const nextNodes = nodes.filter((node) => !removed.has(node.id)); const nodeIds = new Set(nextNodes.map((node) => node.id)); const nextEdges = pruneEdges(edges, nodeIds); setEdges(nextEdges); const phases = draft.project.scenario.phases.filter((phase) => !removed.has(phase.id)) as Draft["project"]["scenario"]["phases"]; saveCanvas({ ...draft, project: { ...draft.project, scenario: { ...draft.project.scenario, phases } } }, nextNodes, nextEdges); }} defaultViewport={draft.document.viewport} onMoveEnd={(event, viewport) => { if (event) saveCanvas({ ...draft, document: { ...draft.document, viewport } }); }}><Background /></ReactFlow></section>
    <Inspector project={draft.project} selectedId={selectedId} localMedia={localManifest?.files ?? []} onRename={renameSelected} onChange={updatePhase} onKindChange={changeSelectedKind} onTransitionChange={changeTransition} onQuestionLayoutChange={changeQuestionLayout} />
    <DiagnosticsPanel project={draft.project} acknowledged={acknowledged} onAcknowledge={(key) => setAcknowledged((current) => { const next = new Set(current); next.has(key) ? next.delete(key) : next.add(key); return next; })} onFocus={(id) => { setSelectedId(id); setShowInspector(true); }} />
  </main>;
}
