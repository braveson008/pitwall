import { ArrowUp } from "lucide-react";
import { useState } from "react";
import type { AgentSession, Project } from "../data";
import type { PitwallTask } from "../domain/types";
import { Dropdown } from "./Dropdown";
import { shortcutLabel } from "../lib/shortcutLabel";

export interface HomeAttention {
  key: string;
  project: Project;
  title: string;
  detail: string;
  action: string;
  onOpen: () => void;
}

interface HomePageProps {
  projects: Project[];
  tasks: PitwallTask[];
  defaultProjectId: string;
  onStart: (projectId: string, instruction: string) => void;
  onOpenSession: (project: Project, session: AgentSession) => void;
  onOpenReview: (project: Project) => void;
}

/**
 * What every project needs from you, and what is moving, on one screen — so
 * the question "what should happen next" can be answered without visiting
 * each project in turn.
 */
export function HomePage({ projects, tasks, defaultProjectId, onStart, onOpenSession, onOpenReview }: HomePageProps) {
  const [instruction, setInstruction] = useState("");
  const [projectId, setProjectId] = useState(defaultProjectId || projects[0]?.id || "");

  const needsYou: HomeAttention[] = [];
  for (const project of projects) {
    for (const session of project.sessions) {
      if (session.status !== "waiting") continue;
      needsYou.push({
        key: `session-${session.id}`,
        project,
        title: session.name,
        detail: `${session.agent} asked something and will not go on until it is answered.`,
        action: "Open",
        onOpen: () => onOpenSession(project, session),
      });
    }
    const inReview = tasks.filter((task) => task.projectId === project.id && task.status === "review");
    if (inReview.length) {
      needsYou.push({
        key: `review-${project.id}`,
        project,
        title: inReview.length === 1 ? inReview[0].title : `${inReview.length} tasks are ready for review`,
        detail: "Finished by an agent and waiting on your eyes.",
        action: "Review",
        onOpen: () => onOpenReview(project),
      });
    }
  }

  const working = projects.flatMap((project) =>
    project.sessions
      .filter((session) => session.status === "running" || session.status === "starting")
      .map((session) => ({ project, session })),
  );

  const start = () => {
    const text = instruction.trim();
    if (!projectId) return;
    onStart(projectId, text);
    setInstruction("");
  };

  return (
    <div className="dk-page dk-home">
      <div className="dk-home-column">
        <section className="dk-home-hero" aria-labelledby="home-title">
          <h1 id="home-title">What should happen next?</h1>
          <div className="dk-home-composer">
            <label htmlFor="home-instruction" className="dk-visually-hidden">Describe the work</label>
            <textarea
              id="home-instruction"
              rows={3}
              value={instruction}
              placeholder="Describe the work, or paste a ticket key"
              onChange={(event) => setInstruction(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  start();
                }
              }}
            />
            <div className="dk-home-composer-bar">
              {projects.length > 0 ? (
                <Dropdown
                  className="dk-dropdown--chip"
                  value={projectId}
                  onChange={setProjectId}
                  ariaLabel="Project"
                  options={projects.map((project) => ({ value: project.id, label: project.name }))}
                />
              ) : null}
              <span className="dk-spacer" />
              <span className="dk-hint">{shortcutLabel("⌘↵ to start")}</span>
              <button
                type="button"
                className="dk-home-send"
                onClick={start}
                disabled={!projectId}
                aria-label="Start a session"
                title="Start a session"
              >
                <ArrowUp size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
        </section>

        <section className="dk-section" aria-labelledby="home-needs">
          <div className="dk-section-head">
            <div>
              <h2 className="dk-section-title" id="home-needs">
                Needs you {needsYou.length ? <span className="dk-home-needs-count">{needsYou.length}</span> : null}
              </h2>
            </div>
          </div>
          {needsYou.length ? (
            <div className="dk-list">
              {needsYou.map((item) => (
                <div className="dk-list-row" key={item.key}>
                  <span className="dk-dot is-needs" aria-hidden="true" />
                  <div className="dk-row-main">
                    <span className="dk-row-sub">{item.project.name}</span>
                    <span className="dk-row-title">{item.title}</span>
                    <span className="dk-row-sub">{item.detail}</span>
                  </div>
                  <button type="button" className="dk-btn dk-btn--sm" onClick={item.onOpen}>{item.action}</button>
                </div>
              ))}
            </div>
          ) : (
            <p className="dk-home-quiet">Nothing is waiting on you.</p>
          )}
        </section>

        <section className="dk-section" aria-labelledby="home-working">
          <div className="dk-section-head">
            <div>
              <h2 className="dk-section-title" id="home-working">Working now</h2>
            </div>
          </div>
          {working.length ? (
            <div className="dk-home-working">
              {working.map(({ project, session }) => (
                <button type="button" className="dk-home-working-row" key={session.id} onClick={() => onOpenSession(project, session)}>
                  <span className="dk-dot is-working" aria-hidden="true" />
                  <span className="dk-home-working-project">{project.name}</span>
                  <span className="dk-home-working-title">{session.name}</span>
                  <span className="dk-faint">{session.agent}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="dk-home-quiet">No agent is working right now.</p>
          )}
        </section>
      </div>
    </div>
  );
}
