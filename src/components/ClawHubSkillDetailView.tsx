import { useEffect } from 'react'
import { useStore } from '../store'

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function ClawHubSkillDetailView() {
  const { selectedClawHubSkill, closeDetailView, installClawHubSkill, installingHubSkill, installHubSkillError, fetchClawHubSkillDetail } = useStore()

  const skill = selectedClawHubSkill
  const isInstalling = skill ? installingHubSkill === skill.slug : false

  // Fetch full details (including owner) when the view opens
  useEffect(() => {
    if (skill?.slug) {
      fetchClawHubSkillDetail(skill.slug)
    }
  }, [skill?.slug, fetchClawHubSkillDetail])

  if (!skill) return null

  const handleInstall = () => {
    installClawHubSkill(skill.slug)
  }

  return (
    <div className="detail-view">
      <div className="detail-header">
        <button className="detail-back" onClick={closeDetailView} aria-label="Back to chat">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          <span>Back</span>
        </button>
        <div className="detail-title-section">
          <div className="detail-icon skill-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
            </svg>
          </div>
          <div>
            <h1 className="detail-title">{skill.name}</h1>
            <p className="detail-subtitle">{skill.description}</p>
          </div>
        </div>
        <div className="detail-actions">
          <button
            className={`clawhub-install-btn ${isInstalling ? 'installing' : ''}`}
            onClick={handleInstall}
            disabled={isInstalling}
          >
            {isInstalling ? (
              <>
                <div className="clawhub-install-spinner" />
                Installing...
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                </svg>
                Install
              </>
            )}
          </button>
        </div>
        {installHubSkillError && (
          <div className="clawhub-install-error">{installHubSkillError}</div>
        )}
      </div>

      <div className="detail-content">
        {/* Security Scan */}
        {skill.vtAnalysis && skill.vtAnalysis.status !== 'not_found' && (
          <section className="detail-section">
            <h2>Security Scan</h2>
            <div className="clawhub-scan-result">
              <div className={`clawhub-scan-badge ${skill.vtAnalysis.status}`}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  {skill.vtAnalysis.status === 'benign' ? (
                    <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" /></>
                  ) : skill.vtAnalysis.status === 'malicious' ? (
                    <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M15 9l-6 6M9 9l6 6" /></>
                  ) : (
                    <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M12 8v4M12 16h.01" /></>
                  )}
                </svg>
                <span className="clawhub-scan-label">
                  {skill.vtAnalysis.status === 'benign' ? 'Benign' :
                   skill.vtAnalysis.status === 'malicious' ? 'Malicious' :
                   skill.vtAnalysis.status === 'suspicious' ? 'Suspicious' :
                   skill.vtAnalysis.status === 'pending' ? 'Scanning...' : 'Error'}
                </span>
              </div>
              {skill.vtAnalysis.stats && (
                <div className="clawhub-scan-stats">
                  <span className="clawhub-scan-stat">{skill.vtAnalysis.stats.malicious} malicious</span>
                  <span className="clawhub-scan-stat">{skill.vtAnalysis.stats.suspicious} suspicious</span>
                  <span className="clawhub-scan-stat">{skill.vtAnalysis.stats.undetected} undetected</span>
                </div>
              )}
              {skill.vtAnalysis.analysis && (
                <pre className="clawhub-scan-analysis">{skill.vtAnalysis.analysis}</pre>
              )}
              {skill.vtAnalysis.vtUrl && (
                <a
                  className="clawhub-scan-link"
                  href={skill.vtAnalysis.vtUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => {
                    e.preventDefault()
                    import('../lib/platform').then(p => p.openExternal(skill.vtAnalysis!.vtUrl!))
                  }}
                >
                  View on VirusTotal
                </a>
              )}
            </div>
          </section>
        )}

        {/* Stats */}
        <section className="detail-section">
          <h2>Details</h2>
          <div className="status-grid">
            {skill.owner.username && (
              <div className="status-item">
                <span className="status-label">Author</span>
                <span className="status-value">{skill.owner.username}</span>
              </div>
            )}
            {skill.version && (
              <div className="status-item">
                <span className="status-label">Version</span>
                <span className="status-value">{skill.version}</span>
              </div>
            )}
            <div className="status-item">
              <span className="status-label">Downloads</span>
              <span className="status-value">{skill.downloads.toLocaleString()}</span>
            </div>
            <div className="status-item">
              <span className="status-label">Stars</span>
              <span className="status-value">{skill.stars.toLocaleString()}</span>
            </div>
            {skill.updatedAt && (
              <div className="status-item">
                <span className="status-label">Updated</span>
                <span className="status-value">{new Date(skill.updatedAt).toLocaleDateString()}</span>
              </div>
            )}
          </div>
        </section>

        {/* Files */}
        {skill.versionFiles && skill.versionFiles.length > 0 && (
          <section className="detail-section">
            <h2>Files</h2>
            <div className="clawhub-files-list">
              {skill.versionFiles.map((file) => (
                <div key={file.path} className="clawhub-file-item">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  <span className="clawhub-file-name">{file.path}</span>
                  <span className="clawhub-file-size">{formatFileSize(file.size)}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Changelog */}
        {skill.changelog && (
          <section className="detail-section">
            <h2>Changelog</h2>
            <pre className="clawhub-changelog">{skill.changelog}</pre>
          </section>
        )}

        {/* Slug (for reference) */}
        <section className="detail-section muted">
          <h2>Install Name</h2>
          <code className="file-path">{skill.slug}</code>
        </section>

        {/* Tags */}
        {skill.tags.length > 0 && (
          <section className="detail-section">
            <h2>Tags</h2>
            <div className="triggers-list">
              {skill.tags.map((tag) => (
                <span key={tag} className="trigger-badge large">
                  {tag}
                </span>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
