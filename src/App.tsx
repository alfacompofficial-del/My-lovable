import { AuthContext, useAuthState } from './hooks/useAuth'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import AuthPage from './pages/AuthPage'
import DashboardPage from './pages/DashboardPage'
import BuilderPage from './pages/BuilderPage'
import './index.css'

function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div style={{ fontSize: 36, marginBottom: 8 }}>⚡</div>
      <div className="spinner spinner-lg" />
    </div>
  )
}

export default function App() {
  const auth = useAuthState()

  if (auth.loading) return <LoadingScreen />

  return (
    <AuthContext.Provider value={auth}>
      <BrowserRouter>
        <Routes>
          <Route
            path="/auth"
            element={auth.user ? <Navigate to="/dashboard" replace /> : <AuthPage />}
          />
          <Route
            path="/dashboard"
            element={auth.user ? <DashboardPage /> : <Navigate to="/auth" replace />}
          />
          <Route
            path="/builder/:projectId?"
            element={auth.user ? <BuilderPage /> : <Navigate to="/auth" replace />}
          />
          <Route
            path="*"
            element={<Navigate to={auth.user ? '/dashboard' : '/auth'} replace />}
          />
        </Routes>
      </BrowserRouter>
    </AuthContext.Provider>
  )
}
