// Director Mode: turns an idea + constraints into a structured production
// package (JSON text). The system prompt is shared with the frontend.
const fs = require('fs')
const path = require('path')
const { json, denied, authHeaders, guard } = require('./_kie')
const { requireAccount, accountProviderKeys } = require('./_auth')

const CHAT_URL = 'https://api.kie.ai/gpt-5-2/v1/chat/completions'
const SYSTEM = fs.readFileSync(path.join(__dirname, '../../data/director-system.md'), 'utf8')

exports.handler = guard('director', async function (event) {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true })
  const no = denied(event)
  if (no) return no
  const auth = await requireAccount(event, { requireProviderSetup: false })
  if (auth.error) return json(auth.error.statusCode, auth.error.body)
  const kieKey = accountProviderKeys(auth.account).kie
  if (!kieKey) return json(403, { error: 'KIE_KEY_REQUIRED' })
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' })

  let body = {}
  try { body = JSON.parse(event.body || '{}') } catch {
    return json(400, { error: 'Invalid JSON body.' })
  }
  const brief = String(body.brief || '').trim()
  if (!brief) return json(400, { error: 'Describe the idea first.' })
  if (brief.length > 12000) return json(400, { error: 'Brief is too long. Keep it under 12,000 characters.' })

  const res = await fetch(CHAT_URL, {
    method: 'POST',
    headers: authHeaders(kieKey),
    body: JSON.stringify({
      messages: [
        { role: 'system', content: [{ type: 'text', text: SYSTEM }] },
        { role: 'user', content: [{ type: 'text', text: brief }] },
      ],
      reasoning_effort: 'high',
    }),
  })
  const raw = await res.text()
  let data = {}
  try { data = raw ? JSON.parse(raw) : {} } catch {}
  if (!res.ok) {
    return json(res.status, {
      error: data.error?.message || data.message || `Kie chat request failed with ${res.status}.`,
      detail: raw.slice(0, 800),
    })
  }
  const content = data.choices?.[0]?.message?.content
  if (!content || typeof content !== 'string') {
    return json(502, { error: 'Kie returned no production package.', detail: raw.slice(0, 800) })
  }
  return json(200, { content, model: data.model || 'gpt-5-2', usage: data.usage || null })
})
