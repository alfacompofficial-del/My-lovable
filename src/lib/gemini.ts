const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY
const GEMINI_MODEL = 'gemini-3.6-flash'
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

export interface GeminiMessage {
  role: 'user' | 'model'
  parts: { text: string }[]
}

export async function generateWithGemini(
  messages: GeminiMessage[],
  systemInstruction?: string
): Promise<string> {
  const body: Record<string, unknown> = {
    contents: messages,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 65536,
    },
  }

  if (systemInstruction) {
    body.systemInstruction = {
      parts: [{ text: systemInstruction }],
    }
  }

  const response = await fetch(GEMINI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': GEMINI_API_KEY,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error?.error?.message || 'Gemini API error')
  }

  const data = await response.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
}

export async function streamWithGemini(
  messages: GeminiMessage[],
  systemInstruction: string,
  onChunk: (text: string) => void
): Promise<string> {
  const streamUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse`

  const body: Record<string, unknown> = {
    contents: messages,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 65536,
    },
    systemInstruction: {
      parts: [{ text: systemInstruction }],
    },
  }

  const response = await fetch(streamUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': GEMINI_API_KEY,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error?.error?.message || 'Gemini API streaming error')
  }

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let fullText = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const chunk = decoder.decode(value, { stream: true })
    const lines = chunk.split('\n')

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const json = JSON.parse(line.slice(6))
          const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
          if (text) {
            fullText += text
            onChunk(text)
          }
        } catch {
          // ignore parse errors for incomplete chunks
        }
      }
    }
  }

  return fullText
}
