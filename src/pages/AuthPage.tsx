import { useState, type FormEvent } from 'react'
import { useAuth } from '../hooks/useAuth'

export default function AuthPage() {
  const { signIn, signUp } = useAuth()
  const [tab, setTab] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (tab === 'register' && password !== confirmPassword) {
      setError('Пароли не совпадают')
      return
    }
    if (password.length < 6) {
      setError('Пароль должен быть не менее 6 символов')
      return
    }

    setLoading(true)
    try {
      if (tab === 'login') {
        const { error } = await signIn(email, password)
        if (error) setError(error)
      } else {
        const { error } = await signUp(email, password)
        if (error) setError(error)
        else setSuccess('Проверьте почту для подтверждения регистрации!')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card glass">
        <div className="auth-logo">
          <div className="auth-logo-icon">⚡</div>
          <span className="auth-logo-text">AlfaComp AI</span>
        </div>

        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>
            {tab === 'login' ? 'Добро пожаловать' : 'Создать аккаунт'}
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {tab === 'login'
              ? 'Войдите чтобы создавать сайты с ИИ'
              : 'Начните строить сайты с помощью ИИ'}
          </p>
        </div>

        <div className="auth-tabs">
          <button
            className={`auth-tab ${tab === 'login' ? 'active' : ''}`}
            onClick={() => { setTab('login'); setError(''); setSuccess('') }}
          >
            Войти
          </button>
          <button
            className={`auth-tab ${tab === 'register' ? 'active' : ''}`}
            onClick={() => { setTab('register'); setError(''); setSuccess('') }}
          >
            Регистрация
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              className="input"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Пароль</label>
            <input
              className="input"
              type="password"
              placeholder="Минимум 6 символов"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
            />
          </div>

          {tab === 'register' && (
            <div className="form-group">
              <label className="form-label">Подтвердить пароль</label>
              <input
                className="input"
                type="password"
                placeholder="Повторите пароль"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
              />
            </div>
          )}

          {error && (
            <div className="form-error" style={{ marginBottom: 12, padding: '8px 12px', background: 'rgba(239,68,68,0.1)', borderRadius: 8 }}>
              ⚠️ {error}
            </div>
          )}
          {success && (
            <div style={{ marginBottom: 12, padding: '8px 12px', background: 'rgba(34,197,94,0.1)', borderRadius: 8, fontSize: 13, color: '#4ade80' }}>
              ✅ {success}
            </div>
          )}

          <button
            className="btn btn-primary w-full btn-lg"
            type="submit"
            disabled={loading}
            style={{ justifyContent: 'center', marginTop: 4 }}
          >
            {loading ? <span className="spinner" /> : null}
            {loading ? 'Загрузка...' : tab === 'login' ? 'Войти' : 'Зарегистрироваться'}
          </button>
        </form>

        <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', marginTop: 20 }}>
          Нажимая кнопку, вы соглашаетесь с условиями использования
        </p>
      </div>
    </div>
  )
}
