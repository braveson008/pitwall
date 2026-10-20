import { Bell, BellOff, BellRing } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { jumpLabel, type AppNotification } from "../lib/notifications";
import { relativeTime } from "../lib/sidebarGroups";

/**
 * The header's bell: what Pitwall told you recently, each with the way back to
 * what it was about. The completion chime's mute lives here too, since it is
 * the other half of the same question — how Pitwall gets your attention.
 */
export function NotificationsMenu({
  notifications,
  soundEnabled,
  onToggleSound,
  onJump,
  onMarkAllSeen,
}: {
  notifications: AppNotification[];
  soundEnabled: boolean;
  onToggleSound: () => void;
  onJump: (notification: AppNotification) => void;
  onMarkAllSeen: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const unseen = notifications.filter((item) => !item.seen).length;
  const now = Date.now();

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div className="dk-notes" ref={root}>
      <button
        type="button"
        className={`dk-icon-button${open ? " is-current" : ""}`}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={unseen ? `Notifications, ${unseen} new` : "Notifications"}
        title="Notifications"
      >
        {soundEnabled ? (unseen ? <BellRing size={15} aria-hidden="true" /> : <Bell size={15} aria-hidden="true" />) : <BellOff size={15} aria-hidden="true" />}
        {unseen ? <span className="dk-notes-badge" aria-hidden="true">{unseen > 9 ? "9+" : unseen}</span> : null}
      </button>
      {open ? (
        <div className="dk-notes-panel" role="dialog" aria-label="Notifications">
          <div className="dk-notes-head">
            <strong>Notifications</strong>
            {unseen ? <button type="button" className="dk-link" onClick={onMarkAllSeen}>Mark all read</button> : null}
          </div>
          {notifications.length === 0 ? (
            <p className="dk-notes-empty">Nothing yet. When an agent finishes, asks you something, or work is ready for review, it shows up here.</p>
          ) : (
            <ul className="dk-notes-list">
              {notifications.map((item) => (
                <li key={item.id} className={`dk-notes-item is-${item.tone}${item.seen ? "" : " is-unseen"}`}>
                  <div className="dk-notes-text">
                    <span className="dk-notes-title">{item.title}</span>
                    {item.body ? <span className="dk-notes-body">{item.body}</span> : null}
                    <span className="dk-notes-when">{relativeTime(item.at, now)}</span>
                  </div>
                  <button
                    type="button"
                    className="dk-btn dk-btn--sm"
                    onClick={() => { setOpen(false); onJump(item); }}
                  >
                    {jumpLabel(item.target)}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <label className="dk-notes-sound">
            <input type="checkbox" checked={soundEnabled} onChange={onToggleSound} />
            Chime when an agent finishes
          </label>
        </div>
      ) : null}
    </div>
  );
}
