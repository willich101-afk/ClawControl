import { useEffect } from 'react'
import { useStore } from './store'
import { Sidebar } from './components/Sidebar'
import { ChatArea } from './components/ChatArea'
import { TopBar } from './components/TopBar'
import { RightPanel } from './components/RightPanel'
import { InputArea } from './components/InputArea'
import { SettingsModal } from './components/SettingsModal'
import { CertErrorModal } from './components/CertErrorModal'
import { SkillDetailView } from './components/SkillDetailView'
import { CronJobDetailView } from './components/CronJobDetailView'
import { AgentDetailView } from './components/AgentDetailView'
import {
  isNativeMobile,
  setStatusBarStyle,
  setupKeyboardListeners,
  setupAppListeners,
  setupBackButton,
  setupAppVisibilityTracking
} from './lib/platform'

function App() {
  const { theme, initializeApp, sidebarOpen, rightPanelOpen, mainView } = useStore()

  useEffect(() => {
    initializeApp()
  }, [initializeApp])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)

    // Update mobile status bar to match theme
    if (isNativeMobile()) {
      setStatusBarStyle(theme === 'dark')
    }
  }, [theme])

  // App visibility tracking (all platforms)
  useEffect(() => {
    const cleanup = setupAppVisibilityTracking()
    return cleanup
  }, [])

  // Mobile platform initialization
  useEffect(() => {
    if (!isNativeMobile()) return

    // Add mobile body class for CSS targeting
    document.body.classList.add('capacitor-mobile')

    // Keyboard handling
    const cleanupKeyboard = setupKeyboardListeners(
      () => {
        document.body.classList.add('keyboard-visible')
      },
      () => {
        document.body.classList.remove('keyboard-visible')
      }
    )

    // App lifecycle - reconnect on resume
    const cleanupApp = setupAppListeners(
      () => {
        const { connected, connect } = useStore.getState()
        if (!connected) {
          connect()
        }
      }
    )

    // Android back button
    const cleanupBack = setupBackButton(() => {
      const state = useStore.getState()
      if (state.mainView !== 'chat') {
        state.closeDetailView()
      } else if (state.sidebarOpen) {
        state.setSidebarOpen(false)
      } else if (state.rightPanelOpen) {
        state.setRightPanelOpen(false)
      }
    })

    return () => {
      cleanupKeyboard()
      cleanupApp()
      cleanupBack()
      document.body.classList.remove('capacitor-mobile')
    }
  }, [])

  return (
    <div className="app">
      <Sidebar />

      <main className="main-content">
        <TopBar />
        {mainView === 'chat' && (
          <>
            <ChatArea />
            <InputArea />
          </>
        )}
        {mainView === 'skill-detail' && <SkillDetailView />}
        {mainView === 'cron-detail' && <CronJobDetailView />}
        {mainView === 'agent-detail' && <AgentDetailView />}
      </main>

      <RightPanel />

      {/* Overlay for mobile */}
      <div
        className={`overlay ${sidebarOpen || rightPanelOpen ? 'active' : ''}`}
        onClick={() => {
          useStore.getState().setSidebarOpen(false)
          useStore.getState().setRightPanelOpen(false)
        }}
      />

      {/* Settings Modal */}
      <SettingsModal />

      {/* Certificate Error Modal */}
      <CertErrorModal />
    </div>
  )
}

export default App
