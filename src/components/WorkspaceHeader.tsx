import type { ReactNode } from "react";

interface WorkspaceHeaderProps {
  title: string;
  /** One quiet line under the title: the task key, the project, the branch. */
  subtitle?: ReactNode;
  actions?: ReactNode;
}

export function WorkspaceHeader({ title, subtitle, actions }: WorkspaceHeaderProps) {
  return (
    <header className="dk-header">
      <div className="dk-header-bar">
        <div className="dk-header-titles">
          <h1>{title}</h1>
          {subtitle ? <p className="dk-header-subtitle">{subtitle}</p> : null}
        </div>
        <span className="dk-header-spacer" />
        {actions ? <div className="dk-header-actions">{actions}</div> : null}
      </div>
    </header>
  );
}
