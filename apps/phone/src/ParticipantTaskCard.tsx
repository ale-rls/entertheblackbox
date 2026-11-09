import { useEffect, useState } from "react";
import type { ServerToClientMessage } from "@entertheblackbox/protocol";

type TaskState = Extract<ServerToClientMessage, { t: "participant_task" }>;
export function ParticipantTaskCard({ state, enabled, clock, respond }: {
  state: TaskState | null; enabled: boolean; clock: { now(): number } | undefined;
  respond: (instanceId: string, optionId: string) => void;
}) {
  const [, refresh] = useState(0);
  useEffect(() => { const timer = setInterval(() => refresh(n => n + 1), 250); return () => clearInterval(timer); }, []);
  const task = state?.task;
  if (!task || task.status === "cancelled") return null;
  const remaining = task.deadlineAt - (clock?.now() ?? Date.now());
  const canAnswer = enabled && task.status === "open" && remaining > 0 &&
    (task.recipient.status === "pending" || task.recipient.status === "full");
  return <section className="participant-task" aria-label="Participant task" onPointerDown={e => e.stopPropagation()}>
    <h1>{task.template.question}</h1>
    {task.status === "open" && <p>{Math.max(0, Math.ceil(remaining / 1000))} seconds remaining</p>}
    <div className="group-selection-options">{task.template.options.map(option => <button key={option.id} type="button"
      disabled={!canAnswer} aria-pressed={task.recipient.optionId === option.id}
      onClick={() => { if (canAnswer) respond(task.id, option.id); }}>{option.label}</button>)}</div>
    <p role="status">{task.recipient.message}</p>
    {(!enabled || remaining <= 0) && <p>{!enabled ? "Reconnecting…" : "Responses closed"}</p>}
  </section>;
}
