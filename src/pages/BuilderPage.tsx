import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { streamWithGemini, type GeminiMessage } from '../lib/gemini'
import {
  extractFilesFromResponse,
  extractRoutes,
  generateSubdomain,
  buildPreviewHtml,
  type GeneratedFile,
} from '../lib/generator'
import { checkAndConsumeRequest, getRemainingRequests } from '../hooks/useRateLimit'
import { publishToGitHub } from '../lib/github'
import JSZip from 'jszip'
import type { Project } from '../lib/supabase'

// ─── System Prompt ────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are AlfaComp AI — an elite web developer creating stunning, production-ready websites.

RULES FOR CODE OUTPUT:
- Output every file using EXACTLY this format (no exceptions):
\`\`\`html:index.html
[complete file content]
\`\`\`
\`\`\`css:style.css
[complete file content]
\`\`\`
\`\`\`javascript:script.js
[complete file content]
\`\`\`

- For multi-page sites: create index.html, about.html, contact.html etc.
- NEVER use placeholder images — use CSS gradients, SVG, or emoji
- Always use Google Fonts, modern CSS (Grid/Flexbox), smooth animations
- Include a nav bar linking all pages with href="./about.html" style links
- Mobile responsive — use @media queries
- Always output COMPLETE, working files — no placeholders or "// rest of code here"

ON FIRST MESSAGE: Ask the user ONE question:
"Хотите сайт **с сервером** (React + TypeScript + backend) или **без сервера** (HTML/CSS/JS)?"

After they choose WITHOUT server: immediately generate ALL website files.

After they choose WITH server: ask step by step:
1. What database? (PostgreSQL/MySQL/MongoDB)
2. What is your DB connection URL?
3. What API endpoints do you need?
Then generate complete React + Vite + TypeScript + Express project.

For React projects output:
\`\`\`typescript:src/App.tsx
\`\`\`
\`\`\`typescript:src/main.tsx
\`\`\`
\`\`\`css:src/index.css
\`\`\`
\`\`\`json:package.json
\`\`\`
\`\`\`typescript:server/index.ts
\`\`\`

IMPORTANT: Always generate BEAUTIFUL, professional designs. No ugly or plain sites.`

// ─── Types ───────────────────────────────────────────────────────
type UIMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
}

// ─── Toast ───────────────────────────────────────────────────────
function Toast({ toasts }: { toasts: { id: string; msg: string; type: string }[] }) {
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          {t.type === 'success' ? '✅' : t.type === 'error' ? '❌' : 'ℹ️'} {t.msg}
        </div>
      ))}
    </div>
  )
}

// ─── Page Navigator ───────────────────────────────────────────────
function PageNavigator({
  routes, active, onSelect,
}: { routes: string[]; active: string; onSelect: (r: string) => void }) {
  if (routes.length === 0) return null
  return (
    <div className="page-navigator">
      <span style={{ fontSize: 11, color: 'var(--text-muted)', paddingRight: 4 }}>Страницы:</span>
      {routes.map(r => (
        <button
          key={r}
          className={`page-nav-item ${active === r ? 'active' : ''}`}
          onClick={() => onSelect(r)}
        >
          {r}
        </button>
      ))}
    </div>
  )
}

// ─── File Icon helper ─────────────────────────────────────────────
function fileIcon(path: string) {
  if (path.endsWith('.html')) return '📄'
  if (path.endsWith('.css')) return '🎨'
  if (path.endsWith('.js') || path.endsWith('.jsx')) return '⚡'
  if (path.endsWith('.ts') || path.endsWith('.tsx')) return '💎'
  if (path.endsWith('.json')) return '📦'
  return '📝'
}

// ─── Code Viewer ─────────────────────────────────────────────────
function CodeViewer({ files }: { files: GeneratedFile[] }) {
  const [active, setActive] = useState(0)

  if (files.length === 0) {
    return (
      <div className="preview-empty">
        <div className="preview-empty-icon">📝</div>
        <div className="preview-empty-title">Код появится здесь</div>
        <div className="preview-empty-sub">Сгенерируйте сайт в чате слева</div>
      </div>
    )
  }

  return (
    <div className="code-viewer">
      <div className="file-tree">
        <div className="file-tree-header">Файлы проекта</div>
        {files.map((f, i) => (
          <div
            key={f.path}
            className={`file-item ${active === i ? 'active' : ''}`}
            onClick={() => setActive(i)}
          >
            <span>{fileIcon(f.path)}</span>
            <span className="truncate" title={f.path}>{f.path}</span>
          </div>
        ))}
      </div>
      <div className="code-content">
        <div style={{
          padding: '6px 16px',
          background: 'rgba(0,0,0,0.3)',
          borderBottom: '1px solid var(--border)',
          fontSize: 11,
          color: 'var(--text-muted)',
          fontFamily: 'JetBrains Mono, monospace',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <span>{files[active]?.path}</span>
          <button
            className="btn btn-ghost btn-sm"
            style={{ fontSize: 11, padding: '2px 8px' }}
            onClick={() => {
              navigator.clipboard.writeText(files[active]?.content ?? '')
            }}
          >
            📋 Копировать
          </button>
        </div>
        <pre style={{ margin: 0, padding: 16, fontFamily: 'JetBrains Mono, monospace', fontSize: 12.5, lineHeight: 1.6, color: '#e2e8f0' }}>
          <code>{files[active]?.content ?? ''}</code>
        </pre>
      </div>
    </div>
  )
}

// ─── Publish Modal ─────────────────────────────────────────────────
function PublishModal({
  subdomain, onClose, onPublish, onGitHub, publishing,
}: {
  subdomain: string
  onClose: () => void
  onPublish: (sub: string) => void
  onGitHub: (token: string, repo: string) => void
  publishing: boolean
}) {
  const [sub, setSub] = useState(subdomain)
  const [tab, setTab] = useState<'deploy' | 'github'>('deploy')
  const [ghToken, setGhToken] = useState('')
  const [ghRepo, setGhRepo] = useState(subdomain.replace(/[^a-z0-9-]/g, '-'))

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal glass" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">🚀 Публикация проекта</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>✕</button>
        </div>

        <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
          <button
            className={`auth-tab ${tab === 'deploy' ? 'active' : ''}`}
            onClick={() => setTab('deploy')}
            style={{ flex: 1 }}
          >
            🌐 Поддомен alfacomp.uz
          </button>
          <button
            className={`auth-tab ${tab === 'github' ? 'active' : ''}`}
            onClick={() => setTab('github')}
            style={{ flex: 1 }}
          >
            🐙 GitHub
          </button>
        </div>

        {tab === 'deploy' ? (
          <div className="modal-body">
            <div>
              <label className="form-label">Ваш поддомен</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  className="input"
                  value={sub}
                  onChange={e => setSub(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  placeholder="my-site"
                />
                <span style={{ color: 'var(--text-muted)', fontSize: 13, whiteSpace: 'nowrap' }}>
                  .alfacomp.uz
                </span>
              </div>
            </div>
            <div className="publish-url">
              🔗 https://{sub || 'my-site'}.alfacomp.uz
            </div>
            <div style={{
              padding: '10px 14px',
              background: 'rgba(34,197,94,0.08)',
              border: '1px solid rgba(34,197,94,0.2)',
              borderRadius: 8,
              fontSize: 12,
              color: '#4ade80',
              lineHeight: 1.6,
            }}>
              🔒 SSL/TLS сертификат будет автоматически выпущен через Let's Encrypt.
              Сайт будет защищён HTTPS.
            </div>
          </div>
        ) : (
          <div className="modal-body">
            <div>
              <label className="form-label">GitHub Personal Access Token</label>
              <input
                className="input font-mono"
                type="password"
                value={ghToken}
                onChange={e => setGhToken(e.target.value)}
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
              />
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                github.com → Settings → Developer Settings → Personal Access Tokens → Classic → repo
              </div>
            </div>
            <div>
              <label className="form-label">Название репозитория</label>
              <input
                className="input"
                value={ghRepo}
                onChange={e => setGhRepo(e.target.value)}
                placeholder="my-website"
              />
            </div>
          </div>
        )}

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={publishing}>
            Отмена
          </button>
          {tab === 'deploy' ? (
            <button
              className="btn btn-primary"
              onClick={() => onPublish(sub)}
              disabled={publishing || !sub}
            >
              {publishing ? <span className="spinner" /> : '🚀'}{' '}
              {publishing ? 'Публикация...' : 'Опубликовать'}
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={() => onGitHub(ghToken, ghRepo)}
              disabled={publishing || !ghToken || !ghRepo}
              style={{ background: '#24292e', border: '1px solid #444' }}
            >
              {publishing ? <span className="spinner" /> : '🐙'}{' '}
              {publishing ? 'Загрузка...' : 'Push to GitHub'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Render chat message (hide code, toggle thinking) ────────────────
function renderMd(text: string) {
  // 1. Убираем все блоки кода, включая те, которые еще пишутся (стримятся)
  let cleanText = text.replace(/```[\s\S]*?(?:```|$)/g, '')
  
  // 2. Оборачиваем <think>...</think> (даже если тег еще не закрыт)
  cleanText = cleanText.replace(
    /<think>([\s\S]*?)(?:<\/think>|$)/gi,
    '<details class="think-block"><summary>🧠 Посмотреть, как думал ИИ</summary><div class="think-content">$1</div></details>'
  )

  // 3. Форматируем остальное
  return cleanText
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code style="background:rgba(0,0,0,0.35);padding:1px 5px;border-radius:4px;font-family:JetBrains Mono,monospace;font-size:11.5px">$1</code>')
    .replace(/\n/g, '<br>')
}

// ─── Main Component ────────────────────────────────────────────────
export default function BuilderPage() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const { user, signOut } = useAuth()

  const [project, setProject] = useState<Project | null>(null)
  const [messages, setMessages] = useState<UIMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)

  const [files, setFiles] = useState<GeneratedFile[]>([])
  const [routes, setRoutes] = useState<string[]>([])
  const [activeRoute, setActiveRoute] = useState('/')
  const [previewTab, setPreviewTab] = useState<'preview' | 'code'>('preview')
  const [previewHtml, setPreviewHtml] = useState('')
  const [iframeKey, setIframeKey] = useState(0)

  const [remaining, setRemaining] = useState(10)
  const [showPublish, setShowPublish] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [toasts, setToasts] = useState<{ id: string; msg: string; type: string }[]>([])

  // Keep full chat history for Gemini context
  const chatHistoryRef = useRef<GeminiMessage[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Prevent double-greeting in StrictMode
  const initializedRef = useRef(false)

  // ── Toast ──
  const toast = useCallback((msg: string, type = 'info') => {
    const id = Math.random().toString(36).slice(2)
    setToasts(t => [...t, { id, msg, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000)
  }, [])

  // ── Scroll to bottom ──
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ── Load initial data ──
  useEffect(() => {
    if (!user || initializedRef.current) return
    initializedRef.current = true
    loadInitial()
  }, [user])

  const addMsg = useCallback((role: 'user' | 'assistant', content: string, streaming = false): string => {
    const id = Math.random().toString(36).slice(2)
    setMessages(prev => [...prev, { id, role, content, streaming }])
    return id
  }, [])

  const loadInitial = async () => {
    if (!user) return

    const { remaining } = await getRemainingRequests(user.id)
    setRemaining(remaining)

    if (projectId) {
      const { data } = await supabase
        .from('projects')
        .select('*')
        .eq('id', projectId)
        .eq('user_id', user.id)
        .single()

      if (data) {
        setProject(data)

        if (data.files && Object.keys(data.files).length > 0) {
          const storedFiles: GeneratedFile[] = Object.entries(data.files as Record<string, string>).map(
            ([path, content]) => ({ path, content, language: path.split('.').pop() || 'text' })
          )
          setFiles(storedFiles)
          const r = extractRoutes(storedFiles)
          setRoutes(r)
          setPreviewHtml(buildPreviewHtml(storedFiles))
        }

        const { data: msgs } = await supabase
          .from('chat_messages')
          .select('*')
          .eq('project_id', projectId)
          .order('created_at')

        if (msgs && msgs.length > 0) {
          setMessages(msgs.map(m => ({ id: m.id, role: m.role as 'user' | 'assistant', content: m.content })))
          chatHistoryRef.current = msgs.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
          }))
          return
        }
      }
    }

    // Greet new conversation
    chatHistoryRef.current = []
    addMsg(
      'assistant',
      '👋 Привет! Я **AlfaComp AI** — ваш персональный разработчик.\n\n' +
      'Опишите, какой сайт вы хотите создать, и я задам несколько уточняющих вопросов.\n\n' +
      '💡 *Например: "Создай лендинг для кофейни с меню и формой бронирования"*'
    )
  }

  // ── Ensure project exists ──
  const ensureProject = async (description: string): Promise<string | null> => {
    if (project) return project.id
    if (!user) return null
    
    // Ensure user profile exists (if they registered before the trigger was created)
    await supabase.from('profiles').upsert({
      id: user.id,
      email: user.email,
    }, { onConflict: 'id' }).select().single()

    const name = description.slice(0, 50)
    const sub = generateSubdomain(name)
    
    const { data, error } = await supabase.from('projects').insert({
      user_id: user.id,
      name,
      description,
      type: 'static',
      subdomain: sub,
      files: {},
      published: false,
    }).select().single()
    
    if (error) {
      console.error('Failed to create project:', error)
      toast('Не удалось создать проект. Проверьте консоль.', 'error')
      return null
    }

    if (data) {
      setProject(data)
      navigate(`/builder/${data.id}`, { replace: true })
      return data.id
    }
    return null
  }

  // ── Send message ──
  const sendMsg = async () => {
    const text = input.trim()
    if (!text || sending || !user) return

    const { allowed, remaining: newRemaining } = await checkAndConsumeRequest(user.id)
    if (!allowed) {
      toast('Лимит 10 запросов в день исчерпан. Попробуйте завтра!', 'error')
      return
    }
    setRemaining(newRemaining)
    setInput('')

    addMsg('user', text)
    chatHistoryRef.current.push({ role: 'user', parts: [{ text }] })

    setSending(true)
    const assistantId = addMsg('assistant', '', true)

    // Ensure we have a project ID to save things to
    const currentProjectId = project?.id || await ensureProject(text)

    try {
      let fullResponse = ''

      // Tell Gemini to think in <think> tags before answering
      const systemInstruction = SYSTEM_PROMPT + '\n\nIMPORTANT: ALWAYS wrap your reasoning and thoughts inside <think>...</think> tags BEFORE writing any final output or code.'

      await streamWithGemini(chatHistoryRef.current, systemInstruction, (chunk) => {
        fullResponse += chunk
        setMessages(prev =>
          prev.map(m => m.id === assistantId ? { ...m, content: fullResponse } : m)
        )
      })

      // Stop streaming indicator
      setMessages(prev =>
        prev.map(m => m.id === assistantId ? { ...m, streaming: false } : m)
      )

      chatHistoryRef.current.push({ role: 'model', parts: [{ text: fullResponse }] })

      // Extract generated files
      const extracted = extractFilesFromResponse(fullResponse)
      if (extracted.length > 0) {
        setFiles(extracted)
        const r = extractRoutes(extracted)
        setRoutes(r)
        if (r.length > 0) setActiveRoute(r[0])
        const html = buildPreviewHtml(extracted)
        setPreviewHtml(html)
        setIframeKey(k => k + 1)
        setPreviewTab('preview')
        toast('✨ Сайт сгенерирован!', 'success')
        
        // Update project files
        if (currentProjectId) {
          const filesJson: Record<string, string> = {}
          extracted.forEach(f => { filesJson[f.path] = f.content })
          await supabase.from('projects').update({
            files: filesJson,
            updated_at: new Date().toISOString(),
          }).eq('id', currentProjectId)
        }
      }

      // Save chat messages to DB
      if (currentProjectId) {
        await supabase.from('chat_messages').insert([
          { project_id: currentProjectId, role: 'user', content: text },
          { project_id: currentProjectId, role: 'assistant', content: fullResponse },
        ])
      }

    } catch (err: unknown) {
      const error = err as Error
      setMessages(prev => prev.map(m =>
        m.id === assistantId
          ? { ...m, content: `❌ Ошибка: ${error.message}`, streaming: false }
          : m
      ))
      toast('Ошибка ИИ: ' + error.message, 'error')
    } finally {
      setSending(false)
    }
  }


  // ── Navigate preview to route ──
  const navigateToRoute = (route: string) => {
    setActiveRoute(route)
    const filename = route === '/' ? 'index.html' : `${route.slice(1)}.html`
    const file = files.find(f => f.path === filename || f.path.endsWith('/' + filename))
    if (file) {
      setPreviewHtml(buildPreviewHtml(files))
      setIframeKey(k => k + 1)
    }
  }

  // ── Download ZIP ──
  const downloadZip = async () => {
    if (files.length === 0) { toast('Нет файлов для скачивания', 'error'); return }
    const zip = new JSZip()
    files.forEach(f => zip.file(f.path, f.content))
    const blob = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${project?.name || 'website'}.zip`
    a.click()
    URL.revokeObjectURL(url)
    toast('📦 Архив скачан!', 'success')
  }

  // ── Publish to subdomain ──
  const handlePublish = async (sub: string) => {
    if (!project || !user) return
    setPublishing(true)
    try {
      await supabase.from('projects').update({ published: true, subdomain: sub }).eq('id', project.id)
      setProject(prev => prev ? { ...prev, published: true, subdomain: sub } : prev)
      setShowPublish(false)
      toast(`🌐 Опубликовано! ${sub}.alfacomp.uz`, 'success')
    } catch {
      toast('Ошибка публикации', 'error')
    } finally {
      setPublishing(false)
    }
  }

  // ── Push to GitHub ──
  const handleGitHub = async (token: string, repoName: string) => {
    if (files.length === 0) { toast('Нет файлов', 'error'); return }
    setPublishing(true)
    try {
      const filesObj: Record<string, string> = {}
      files.forEach(f => { filesObj[f.path] = f.content })
      const result = await publishToGitHub(token, repoName, filesObj)
      if (result.success) {
        setShowPublish(false)
        toast('🐙 Загружено на GitHub!', 'success')
        window.open(result.url, '_blank')
      } else {
        toast('Ошибка GitHub: ' + result.error, 'error')
      }
    } finally {
      setPublishing(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg() }
  }

  const hasFiles = files.length > 0
  const publishedUrl = project?.published && project?.subdomain
    ? `https://${project.subdomain}.alfacomp.uz`
    : null

  return (
    <div className="app-layout">
      {/* ── Header ── */}
      <header className="header">
        <button
          className="header-logo"
          onClick={() => navigate('/dashboard')}
          style={{ background: 'none', border: 'none', cursor: 'pointer' }}
        >
          <div className="header-logo-icon">⚡</div>
          <span className="header-logo-text">AlfaComp AI</span>
        </button>

        {/* Page routes navigator */}
        {routes.length > 0 && (
          <>
            <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />
            <PageNavigator routes={routes} active={activeRoute} onSelect={navigateToRoute} />
          </>
        )}

        <div className="header-sep" />

        {/* Published link */}
        {publishedUrl && (
          <a
            href={publishedUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: 12,
              color: '#4ade80',
              textDecoration: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 10px',
              background: 'rgba(34,197,94,0.1)',
              borderRadius: 6,
              border: '1px solid rgba(34,197,94,0.25)',
              fontFamily: 'JetBrains Mono, monospace',
            }}
          >
            🔗 {project?.subdomain}.alfacomp.uz
          </a>
        )}

        {/* Actions */}
        <div className="header-actions">
          {/* Requests counter */}
          <div className={`requests-badge ${remaining <= 2 ? 'low' : ''}`}>
            <span>Запросы:</span>
            <span className="count">{remaining}/10</span>
          </div>

          {/* Download ZIP — always visible, disabled if no files */}
          <button
            className="btn btn-secondary btn-sm"
            onClick={downloadZip}
            disabled={!hasFiles}
            title={hasFiles ? 'Скачать ZIP' : 'Сначала сгенерируйте сайт'}
          >
            ⬇️ ZIP
          </button>

          {/* Publish — always visible */}
          <button
            className="btn btn-primary btn-sm"
            onClick={() => hasFiles ? setShowPublish(true) : toast('Сначала сгенерируйте сайт', 'error')}
            style={{ opacity: hasFiles ? 1 : 0.5 }}
          >
            🚀 Публикация
          </button>

          {/* Sign out */}
          <button className="btn btn-ghost btn-sm" onClick={signOut}>
            Выйти
          </button>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="main-area">

        {/* ── Chat Panel ── */}
        <div className="chat-panel">
          <div className="chat-header">
            <span>💬</span>
            <span className="chat-header-title">Чат с ИИ</span>
            <span className="chat-header-badge">Gemini 3.6 Flash</span>
            {project?.name && (
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                📁 {project.name}
              </span>
            )}
          </div>

          <div className="chat-messages">
            {messages.map(msg => (
              <div key={msg.id} className={`chat-message ${msg.role}`}>
                <div className="chat-avatar">
                  {msg.role === 'user' ? '👤' : '🤖'}
                </div>
                <div className="chat-bubble">
                  {msg.streaming && msg.content === '' ? (
                    <div className="typing-dots"><span /><span /><span /></div>
                  ) : (
                    <div dangerouslySetInnerHTML={{ __html: renderMd(msg.content) }} />
                  )}
                  {msg.streaming && msg.content !== '' && (
                    <span style={{
                      display: 'inline-block', width: 7, height: 13,
                      background: 'var(--accent)', marginLeft: 2,
                      animation: 'pulse 0.7s infinite', borderRadius: 1,
                    }} />
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          <div className="chat-input-area">
            {remaining === 0 && (
              <div style={{ fontSize: 12, color: 'var(--danger)', textAlign: 'center', padding: '4px 0' }}>
                ⚠️ Лимит запросов исчерпан. Возобновится завтра.
              </div>
            )}
            <div className="chat-input-row">
              <textarea
                ref={textareaRef}
                className="chat-textarea"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  remaining === 0
                    ? 'Лимит исчерпан...'
                    : 'Опишите сайт... (Enter — отправить, Shift+Enter — новая строка)'
                }
                disabled={sending || remaining === 0}
                rows={1}
              />
              <button
                className="send-btn"
                onClick={sendMsg}
                disabled={sending || !input.trim() || remaining === 0}
                title="Отправить"
              >
                {sending
                  ? <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }} />
                  : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="22" y1="2" x2="11" y2="13" />
                      <polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                }
              </button>
            </div>
          </div>
        </div>

        {/* ── Preview Panel ── */}
        <div className="preview-panel">
          {/* Preview / Code tabs */}
          <div className="preview-tabs">
            <button
              className={`preview-tab ${previewTab === 'preview' ? 'active' : ''}`}
              onClick={() => setPreviewTab('preview')}
            >
              👁️ Превью
            </button>
            <button
              className={`preview-tab ${previewTab === 'code' ? 'active' : ''}`}
              onClick={() => setPreviewTab('code')}
            >
              📝 Код {hasFiles && <span style={{ fontSize: 10, marginLeft: 4, background: 'rgba(99,102,241,0.3)', padding: '1px 5px', borderRadius: 4 }}>{files.length}</span>}
            </button>

            {/* URL bar */}
            {previewHtml && (
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                <div className="url-bar" style={{ minWidth: 200 }}>
                  {project?.subdomain
                    ? `${project.subdomain}.alfacomp.uz${activeRoute}`
                    : `preview${activeRoute}`}
                </div>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ fontSize: 11, padding: '3px 8px' }}
                  onClick={() => setIframeKey(k => k + 1)}
                  title="Обновить"
                >
                  🔄
                </button>
              </div>
            )}
          </div>

          {/* Content */}
          <div className="preview-content">
            {previewTab === 'preview' ? (
              previewHtml ? (
                <iframe
                  key={iframeKey}
                  className="preview-iframe"
                  srcDoc={previewHtml}
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                  title="Превью сайта"
                />
              ) : (
                <div className="preview-empty">
                  <div className="preview-empty-icon">🎨</div>
                  <div className="preview-empty-title">Превью появится здесь</div>
                  <div className="preview-empty-sub">
                    Опишите сайт в чате слева — ИИ сгенерирует его в реальном времени
                  </div>
                  <button className="btn btn-primary" onClick={() => textareaRef.current?.focus()}>
                    ✨ Начать
                  </button>
                </div>
              )
            ) : (
              <CodeViewer files={files} />
            )}
          </div>
        </div>
      </div>

      {/* ── Publish Modal ── */}
      {showPublish && (
        <PublishModal
          subdomain={project?.subdomain || generateSubdomain(project?.name || 'my-site')}
          onClose={() => setShowPublish(false)}
          onPublish={handlePublish}
          onGitHub={handleGitHub}
          publishing={publishing}
        />
      )}

      {/* ── Toasts ── */}
      <Toast toasts={toasts} />
    </div>
  )
}
