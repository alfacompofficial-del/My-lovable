import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import type { Project } from '../lib/supabase'

export default function DashboardPage() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadProjects()
  }, [user])

  const loadProjects = async () => {
    if (!user) return
    const { data } = await supabase
      .from('projects')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
    setProjects(data ?? [])
    setLoading(false)
  }

  const deleteProject = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('Удалить проект?')) return
    await supabase.from('projects').delete().eq('id', id)
    setProjects(p => p.filter(x => x.id !== id))
  }

  const formatDate = (str: string) =>
    new Date(str).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })

  const getEmoji = (type: string) => type === 'react' ? '⚛️' : '🌐'

  return (
    <div className="app-layout">
      {/* Header */}
      <header className="header">
        <a className="header-logo" href="#">
          <div className="header-logo-icon">⚡</div>
          <span className="header-logo-text">AlfaComp AI</span>
        </a>
        <div className="header-sep" />
        <div className="header-actions">
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{user?.email}</span>
          <button className="btn btn-secondary btn-sm" onClick={signOut}>
            Выйти
          </button>
        </div>
      </header>

      {/* Content */}
      <div className="dashboard-page">
        <div className="dashboard-header">
          <div>
            <h1 className="dashboard-title">
              Мои проекты
            </h1>
            <p className="dashboard-subtitle">
              {projects.length} проект{projects.length === 1 ? '' : projects.length < 5 ? 'а' : 'ов'} создано
            </p>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => navigate('/builder')}
          >
            ✨ Новый проект
          </button>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
            <div className="spinner spinner-lg" />
          </div>
        ) : (
          <div className="projects-grid">
            {/* New project card */}
            <div
              className="new-project-card glass"
              onClick={() => navigate('/builder')}
            >
              <div style={{ fontSize: 36 }}>+</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Создать проект</div>
              <div style={{ fontSize: 12, textAlign: 'center', lineHeight: 1.5 }}>
                Опишите идею — ИИ построит сайт
              </div>
            </div>

            {projects.map(project => (
              <div
                key={project.id}
                className="project-card glass"
                onClick={() => navigate(`/builder/${project.id}`)}
              >
                <div className="project-card-icon">{getEmoji(project.type)}</div>
                <div className="project-card-name truncate">{project.name || 'Без названия'}</div>
                <div className="project-card-desc truncate">{project.description || 'Нет описания'}</div>
                <div className="project-card-meta">
                  <span className={`project-card-badge ${project.type === 'react' ? 'badge-react' : 'badge-static'}`}>
                    {project.type === 'react' ? 'React' : 'Static'}
                  </span>
                  {project.published && (
                    <span className="project-card-badge badge-published">Опубликован</span>
                  )}
                  <span style={{ marginLeft: 'auto' }}>{formatDate(project.updated_at)}</span>
                  <button
                    className="btn btn-ghost btn-sm btn-danger"
                    style={{ padding: '2px 6px', fontSize: 11 }}
                    onClick={(e) => deleteProject(project.id, e)}
                  >
                    🗑
                  </button>
                </div>
                {project.published && project.subdomain && (
                  <div style={{ marginTop: 10 }}>
                    <a
                      href={`https://${project.subdomain}.alfacomp.uz`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono"
                      style={{ fontSize: 11, color: 'var(--accent-bright)', textDecoration: 'none' }}
                      onClick={e => e.stopPropagation()}
                    >
                      🔗 {project.subdomain}.alfacomp.uz
                    </a>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
