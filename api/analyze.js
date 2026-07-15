export const maxDuration = 60;

// openrouter/free = OpenRouter 공식 자동 라우터 (살아있는 무료 모델 자동 선택, 2026.02 출시)
// 특정 모델이 죽어도 자동으로 다른 모델로 넘어가므로 가장 안정적
const MODEL_FALLBACKS = [
  'openrouter/free',                         // 1순위: 자동 라우터 (항상 살아있는 모델 선택)
  'meta-llama/llama-3.3-70b-instruct:free',  // 2순위: 가장 안정적인 무료 고정 모델
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function tryModel(apiKey, model, prompt) {
  let response;
  try {
    response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://localize-site.vercel.app',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: '당신은 로컬라이징 전문가입니다. 반드시 완전한 JSON만 출력하세요. 마크다운 없이. 절대 JSON을 중간에 자르지 마세요.',
          },
          { role: 'user', content: prompt },
        ],
        max_tokens: 2500,
        temperature: 0.7,
      }),
    });
  } catch {
    return { ok: false, reason: 'network' };
  }

  if (response.status === 429) return { ok: false, reason: 'rate_limited' };

  const data = await response.json().catch(() => null);
  if (!response.ok || !data || data.error) return { ok: false, reason: 'api_error' };

  const choice = data?.choices?.[0];
  if (choice?.finish_reason === 'length') return { ok: false, reason: 'truncated' };

  let text = (choice?.message?.content || '')
    .replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  if (!text) return { ok: false, reason: 'empty' };

  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s !== -1 && e > s) text = text.slice(s, e + 1);

  try {
    JSON.parse(text);
    return { ok: true, text };
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prompt } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  for (const model of MODEL_FALLBACKS) {
    const result = await tryModel(apiKey, model, prompt);
    if (result.ok) return res.status(200).json({ content: [{ text: result.text }] });
    if (result.reason === 'rate_limited') await sleep(2000);
  }

  return res.status(502).json({ error: '일시적으로 AI 서버가 응답하지 않아요. 잠시 후 다시 시도해 주세요.' });
}
