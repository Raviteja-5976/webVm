"use client";

import { useState } from "react";
import { CheckCircle2, ChevronLeft, CircleDashed, LoaderCircle, Play, XCircle } from "lucide-react";
import { LESSONS, type Lesson } from "@/lib/lessons";
import { useSandbox } from "@/lib/store";
import { Button } from "./Dialog";
import { RichText } from "./RichText";

type CheckState = "idle" | "checking" | "pass" | "fail" | "unsupported";

export default function LessonsPanel() {
  const preset = useSandbox((s) => s.preset);
  // undefined = the learner hasn't picked yet, so show the preset's suggested lesson.
  const [choice, setOpenId] = useState<string | null | undefined>(undefined);
  const [results, setResults] = useState<Record<string, CheckState>>({});
  const openId = choice === undefined ? (preset?.lesson ?? null) : choice;
  const lesson = LESSONS.find((l) => l.id === openId);

  if (lesson) {
    return (
      <LessonView
        lesson={lesson}
        check={results[lesson.id] ?? "idle"}
        setCheck={(c) => setResults((r) => ({ ...r, [lesson.id]: c }))}
        onBack={() => setOpenId(null)}
      />
    );
  }

  return (
    <div className="h-full overflow-auto p-3">
      <p className="px-1 pb-3 text-xs text-muted">Short guided lessons. Commands run in your sandbox with one click.</p>
      <ul className="flex flex-col gap-2">
        {LESSONS.map((l, i) => (
          <li key={l.id}>
            <button
              onClick={() => setOpenId(l.id)}
              className="group flex w-full items-start gap-3 rounded-md border border-line bg-panel-2 p-3 text-left transition-colors hover:border-line-strong hover:bg-raised"
            >
              <span className="mt-0.5 font-mono text-xs text-faint">{String(i + 1).padStart(2, "0")}</span>
              <span className="flex-1">
                <span className="block text-sm font-medium">{l.title}</span>
                <span className="block text-xs text-muted">{l.summary}</span>
              </span>
              <StatusIcon state={results[l.id] ?? "idle"} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LessonView({
  lesson,
  check,
  setCheck,
  onBack,
}: {
  lesson: Lesson;
  check: CheckState;
  setCheck: (c: CheckState) => void;
  onBack: () => void;
}) {
  const status = useSandbox((s) => s.status);
  const typeInTerminal = useSandbox((s) => s.typeInTerminal);
  const exec = useSandbox((s) => s.exec);
  const running = status === "running";

  const runCheck = async () => {
    if (!lesson.task) return;
    setCheck("checking");
    try {
      const res = await exec(lesson.task.check);
      setCheck(res.status === 0 ? "pass" : res.status === 127 && res.stderr.includes("mock") ? "unsupported" : "fail");
    } catch {
      setCheck("fail");
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        <button onClick={onBack} className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted hover:bg-raised hover:text-text">
          <ChevronLeft className="h-3.5 w-3.5" /> All lessons
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <h2 className="text-base font-semibold">{lesson.title}</h2>
        <p className="mt-1 text-xs text-muted">{lesson.summary}</p>
        <ol className="mt-4 flex flex-col gap-4">
          {lesson.steps.map((step, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line-strong font-mono text-[10px] text-muted">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1 text-[13px] leading-relaxed text-muted">
                <RichText text={step.text} />
                {step.cmd && (
                  <div className="mt-2 flex items-stretch overflow-hidden rounded-md border border-line bg-bg">
                    <code className="min-w-0 flex-1 overflow-x-auto px-2.5 py-1.5 font-mono text-xs whitespace-pre text-text">{step.cmd}</code>
                    <button
                      disabled={!running}
                      onClick={() => typeInTerminal(step.cmd!, true)}
                      title="Run in sandbox"
                      aria-label={`Run in sandbox: ${step.cmd}`}
                      className="flex shrink-0 items-center gap-1 border-l border-line px-2 text-xs text-accent hover:bg-accent/10 disabled:text-faint disabled:hover:bg-transparent"
                    >
                      <Play className="h-3 w-3 fill-current" /> Run
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
      {lesson.task && (
        <div className="border-t border-line bg-panel-2 p-3">
          <div className="flex items-start gap-2">
            <StatusIcon state={check} />
            <div className="flex-1 text-xs">
              <div className="font-semibold tracking-wide text-faint uppercase">Your task</div>
              <div className="mt-0.5 text-[13px] text-text">{lesson.task.goal}</div>
              {check === "pass" && <div className="mt-1 text-accent">Done. Nice work.</div>}
              {check === "fail" && <div className="mt-1 text-danger">Not yet. Keep going and check again.</div>}
              {check === "unsupported" && <div className="mt-1 text-warn">Task checks need a real VM engine.</div>}
            </div>
            <Button size="sm" disabled={!running || check === "checking"} onClick={() => void runCheck()} data-testid="check-task">
              {check === "checking" ? "Checking…" : "Check"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusIcon({ state }: { state: CheckState }) {
  const cls = "h-4 w-4 shrink-0";
  if (state === "pass") return <CheckCircle2 className={`${cls} text-accent`} aria-label="Completed" />;
  if (state === "fail") return <XCircle className={`${cls} text-danger`} aria-label="Not complete" />;
  if (state === "checking") return <LoaderCircle className={`${cls} animate-spin text-muted`} aria-label="Checking" />;
  return <CircleDashed className={`${cls} text-faint`} aria-hidden />;
}
