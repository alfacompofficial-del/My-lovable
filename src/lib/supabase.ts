import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)

export type Profile = {
  id: string
  email: string
  daily_requests: number
  last_request_date: string
  created_at: string
}

export type Project = {
  id: string
  user_id: string
  name: string
  description: string
  type: 'static' | 'react'
  subdomain: string
  files: Record<string, string>
  published: boolean
  created_at: string
  updated_at: string
}

export type ChatMessage = {
  id: string
  project_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}
