/**
 * The mark: an agent's prompt and the reviewer's tick. The prompt takes
 * `currentColor`; the tick stays the accent, because it is the part that
 * means "checked".
 */
export function PitwallMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3.5 7.5L8 12l-4.5 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11.5 12.5l2.5 2.5 6-6" fill="none" stroke="var(--blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
