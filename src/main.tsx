import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { SubagentViewer } from './components/SubagentViewer'
import './styles/index.css'

function parseSubagentHash(): {
  sessionKey: string
  serverUrl: string
  authToken: string
  authMode: 'token' | 'password'
} | null {
  const hash = window.location.hash
  if (!hash.startsWith('#subagent?')) return null

  const params = new URLSearchParams(hash.slice('#subagent?'.length))
  const sessionKey = params.get('sessionKey')
  const serverUrl = params.get('serverUrl')
  const authToken = params.get('authToken')
  const authMode = params.get('authMode')

  if (!sessionKey || !serverUrl || !authToken) return null

  return {
    sessionKey,
    serverUrl,
    authToken,
    authMode: authMode === 'password' ? 'password' : 'token'
  }
}

const subagentParams = parseSubagentHash()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {subagentParams ? (
      <SubagentViewer
        sessionKey={subagentParams.sessionKey}
        serverUrl={subagentParams.serverUrl}
        authToken={subagentParams.authToken}
        authMode={subagentParams.authMode}
      />
    ) : (
      <App />
    )}
  </React.StrictMode>
)
