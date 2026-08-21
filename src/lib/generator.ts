export interface GeneratedFile {
  path: string
  content: string
  language: string
}

export interface GeneratedSite {
  files: GeneratedFile[]
  routes: string[]
  type: 'static' | 'react'
  name: string
  subdomain: string
}

export function extractFilesFromResponse(response: string): GeneratedFile[] {
  const files: GeneratedFile[] = []
  // Match ```language\npath:filename\ncontent\n``` or ```language:filename\ncontent\n```
  const codeBlockRegex = /```(\w+)(?::([^\n]+))?\n([\s\S]*?)```/g
  let match

  while ((match = codeBlockRegex.exec(response)) !== null) {
    const language = match[1]
    const rawPath = match[2]
    const content = match[3].trim()

    if (!rawPath) continue

    files.push({
      path: rawPath.trim(),
      content,
      language,
    })
  }

  // Also look for FILE: markers
  const fileMarkerRegex = /\/\/ FILE: ([^\n]+)\n([\s\S]*?)(?=\/\/ FILE:|$)/g
  while ((match = fileMarkerRegex.exec(response)) !== null) {
    const path = match[1].trim()
    const content = match[2].trim()
    const ext = path.split('.').pop() || 'txt'
    const langMap: Record<string, string> = {
      html: 'html',
      css: 'css',
      js: 'javascript',
      ts: 'typescript',
      tsx: 'typescript',
      jsx: 'javascript',
      json: 'json',
    }
    if (!files.find((f) => f.path === path)) {
      files.push({ path, content, language: langMap[ext] || 'text' })
    }
  }

  return files
}

export function extractRoutes(files: GeneratedFile[]): string[] {
  const routes = new Set<string>(['/'])

  for (const file of files) {
    // Look for route definitions in HTML/JS/TS files
    if (file.path.endsWith('.html')) {
      const nameMatch = file.path.match(/([^/]+)\.html$/)
      if (nameMatch && nameMatch[1] !== 'index') {
        routes.add(`/${nameMatch[1]}`)
      }
    }

    // Look for React Router paths
    const routeMatches = file.content.matchAll(/path=["']([^"']+)["']/g)
    for (const m of routeMatches) {
      routes.add(m[1])
    }

    // Look for href links that look like routes
    const hrefMatches = file.content.matchAll(/href=["'](\/[^"'#?]*)["']/g)
    for (const m of hrefMatches) {
      if (!m[1].includes('.')) routes.add(m[1])
    }
  }

  return Array.from(routes).sort()
}

export function generateSubdomain(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30) +
    '-' + Math.random().toString(36).slice(2, 6)
}

export function buildPreviewHtml(files: GeneratedFile[]): string {
  const indexFile = files.find(
    (f) => f.path === 'index.html' || f.path === 'public/index.html'
  )
  if (!indexFile) {
    // Build a simple HTML shell
    const cssFile = files.find((f) => f.path.endsWith('.css'))
    const jsFile = files.find((f) => f.path.endsWith('.js') || f.path.endsWith('.ts'))

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>${cssFile?.content ?? ''}</style>
</head>
<body>
<script type="module">${jsFile?.content ?? ''}</script>
</body>
</html>`
  }

  let html = indexFile.content

  // Inline CSS files
  files
    .filter((f) => f.path.endsWith('.css'))
    .forEach((f) => {
      const name = f.path.split('/').pop()!
      html = html.replace(
        new RegExp(`<link[^>]*href=["']${name}["'][^>]*>`, 'g'),
        `<style>${f.content}</style>`
      )
    })

  // Inline JS files
  files
    .filter((f) => f.path.endsWith('.js') && !f.path.includes('node_modules'))
    .forEach((f) => {
      const name = f.path.split('/').pop()!
      html = html.replace(
        new RegExp(`<script[^>]*src=["']${name}["'][^>]*></script>`, 'g'),
        `<script>${f.content}</script>`
      )
    })

  return html
}
