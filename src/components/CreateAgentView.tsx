import { useState, useRef } from 'react'
import { useStore } from '../store'

export function CreateAgentView() {
  const { closeDetailView, createAgent } = useStore()
  const [name, setName] = useState('')
  const [workspace, setWorkspace] = useState('')
  const [model, setModel] = useState('')
  const [emoji, setEmoji] = useState('')
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [avatarDataUri, setAvatarDataUri] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setError('Please select an image file')
      return
    }

    // Limit to 2MB for data URI
    if (file.size > 2 * 1024 * 1024) {
      setError('Image must be under 2MB')
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      const dataUri = reader.result as string
      setAvatarPreview(dataUri)
      setAvatarDataUri(dataUri)
      setError(null)
    }
    reader.readAsDataURL(file)
  }

  const handleRemoveAvatar = () => {
    setAvatarPreview(null)
    setAvatarDataUri(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const trimmedName = name.trim()
    const trimmedWorkspace = workspace.trim()

    if (!trimmedName) {
      setError('Agent name is required')
      return
    }
    if (!trimmedWorkspace) {
      setError('Workspace path is required')
      return
    }

    setCreating(true)
    try {
      const result = await createAgent({
        name: trimmedName,
        workspace: trimmedWorkspace,
        model: model.trim() || undefined,
        emoji: emoji.trim() || undefined,
        avatar: avatarDataUri || undefined
      })

      if (!result.success) {
        setError(result.error || 'Failed to create agent')
      }
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="detail-view">
      <div className="detail-content">
        <section className="detail-section">
          <div className="agent-profile-header">
            <button className="detail-back" onClick={closeDetailView} aria-label="Back to chat">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              <span>Back</span>
            </button>
          </div>

          <h1 className="create-agent-title">Create New Agent</h1>

          <form className="create-agent-form" onSubmit={handleSubmit}>
            {/* Avatar Upload */}
            <div className="create-agent-avatar-section">
              <div
                className="create-agent-avatar-picker"
                onClick={() => fileInputRef.current?.click()}
                title="Click to upload avatar"
              >
                {avatarPreview ? (
                  <img src={avatarPreview} alt="Avatar preview" className="create-agent-avatar-preview" />
                ) : (
                  <div className="create-agent-avatar-placeholder">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M12 16a4 4 0 100-8 4 4 0 000 8z" />
                      <path d="M3 16.8V9.2c0-1.12 0-1.68.218-2.108a2 2 0 01.874-.874C4.52 6 5.08 6 6.2 6h.393c.554 0 .831 0 1.086-.076a2 2 0 00.677-.37c.204-.167.364-.393.683-.844L9.6 4l.063-.084c.219-.292.329-.438.466-.548a2 2 0 01.675-.37C11.07 3 11.35 3 11.9 3h.2c.55 0 .83 0 1.096.098a2 2 0 01.675.37c.137.11.247.256.466.548L14.4 4l.56.747c.32.45.48.676.684.843a2 2 0 00.677.37c.255.077.532.077 1.086.077h.393c1.12 0 1.68 0 2.108.218a2 2 0 01.874.874C21 7.52 21 8.08 21 9.2v7.6c0 1.12 0 1.68-.218 2.108a2 2 0 01-.874.874C19.48 20 18.92 20 17.8 20H6.2c-1.12 0-1.68 0-2.108-.218a2 2 0 01-.874-.874C3 18.48 3 17.92 3 16.8z" />
                    </svg>
                    <span>Upload Photo</span>
                  </div>
                )}
              </div>
              {avatarPreview && (
                <button type="button" className="create-agent-avatar-remove" onClick={handleRemoveAvatar}>
                  Remove
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleAvatarSelect}
                style={{ display: 'none' }}
              />
            </div>

            {/* Name */}
            <div className="form-group">
              <label htmlFor="agent-name">Name <span className="required">*</span></label>
              <input
                id="agent-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Agent"
                autoFocus
                disabled={creating}
              />
            </div>

            {/* Workspace */}
            <div className="form-group">
              <label htmlFor="agent-workspace">Workspace Path <span className="required">*</span></label>
              <input
                id="agent-workspace"
                type="text"
                value={workspace}
                onChange={(e) => setWorkspace(e.target.value)}
                placeholder="~/agents/my-agent"
                disabled={creating}
              />
              <span className="form-hint">Absolute path on the server where agent files will be stored</span>
            </div>

            {/* Model */}
            <div className="form-group">
              <label htmlFor="agent-model">Model</label>
              <input
                id="agent-model"
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="e.g. claude-sonnet-4-5-20250929"
                disabled={creating}
              />
              <span className="form-hint">LLM model identifier (optional, can be set later)</span>
            </div>

            {/* Emoji */}
            <div className="form-group">
              <label htmlFor="agent-emoji">Emoji</label>
              <input
                id="agent-emoji"
                type="text"
                value={emoji}
                onChange={(e) => setEmoji(e.target.value)}
                placeholder="e.g. 🤖"
                maxLength={4}
                disabled={creating}
                className="emoji-input"
              />
            </div>

            {/* Error Display */}
            {error && (
              <div className="create-agent-error">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 8v4M12 16h.01" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            {/* Actions */}
            <div className="create-agent-actions">
              <button type="button" className="btn btn-secondary" onClick={closeDetailView} disabled={creating}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={creating || !name.trim() || !workspace.trim()}>
                {creating ? 'Creating...' : 'Create Agent'}
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  )
}
