import { supabase } from '../lib/supabase'

const DAILY_LIMIT = 10

export async function checkAndConsumeRequest(userId: string): Promise<{
  allowed: boolean
  remaining: number
  used: number
}> {
  const today = new Date().toISOString().split('T')[0]

  const { data, error } = await supabase
    .from('profiles')
    .select('daily_requests, last_request_date')
    .eq('id', userId)
    .single()

  if (error || !data) {
    // Create profile if doesn't exist
    await supabase.from('profiles').upsert({
      id: userId,
      daily_requests: 0,
      last_request_date: today,
    })
    await supabase
      .from('profiles')
      .update({ daily_requests: 1, last_request_date: today })
      .eq('id', userId)
    return { allowed: true, remaining: DAILY_LIMIT - 1, used: 1 }
  }

  const isNewDay = data.last_request_date !== today
  const currentCount = isNewDay ? 0 : (data.daily_requests ?? 0)

  if (currentCount >= DAILY_LIMIT) {
    return { allowed: false, remaining: 0, used: currentCount }
  }

  await supabase
    .from('profiles')
    .update({
      daily_requests: currentCount + 1,
      last_request_date: today,
    })
    .eq('id', userId)

  return {
    allowed: true,
    remaining: DAILY_LIMIT - currentCount - 1,
    used: currentCount + 1,
  }
}

export async function getRemainingRequests(userId: string): Promise<{
  remaining: number
  used: number
}> {
  const today = new Date().toISOString().split('T')[0]

  const { data } = await supabase
    .from('profiles')
    .select('daily_requests, last_request_date')
    .eq('id', userId)
    .single()

  if (!data) return { remaining: DAILY_LIMIT, used: 0 }

  const isNewDay = data.last_request_date !== today
  const used = isNewDay ? 0 : (data.daily_requests ?? 0)

  return { remaining: DAILY_LIMIT - used, used }
}
