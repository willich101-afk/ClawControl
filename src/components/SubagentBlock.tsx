import type { SubagentInfo } from '../store'

export function SubagentBlock({
  subagent,
  onOpen
}: {
  subagent: SubagentInfo
  onOpen: (sessionKey: string) => void
}) {
  const isRunning = subagent.status === 'running'

  return (
    <button
      className={`subagent-block ${isRunning ? 'running' : 'completed'}`}
      onClick={() => onOpen(subagent.sessionKey)}
    >
      <div className="subagent-header">
        {isRunning ? (
          <svg className="subagent-icon spinning" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
        ) : (
          <svg className="subagent-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        )}
        <span className="subagent-type">Subagent</span>
        <span className="subagent-label">{subagent.label}</span>
        <span className="subagent-status">{isRunning ? 'Running...' : 'Completed'}</span>
        <svg className="subagent-open-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
      </div>
    </button>
  )
}
