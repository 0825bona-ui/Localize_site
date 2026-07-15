function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// 한 번 OpenRouter 호출. 결과 상태를 세분화해서 반환:
// { status: 'ok', text } | { status: 'rate_limited' } | { status: 'retryable' } | { status: 'fatal', error }
async function callOpenRouter(apiKey, prompt, maxTokens) {
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
        model: 'google/gemma-3-12b-it:free',
        messages: [
          {
            role: 'system',
            content: '당신은 로컬라이징 전문가입니다. 반드시 완전한 JSON만 출력하세요. 마크다운 없이. 절대 JSON을 중간에 자르지 마세요.'
          },
          { role: 'user', content: prompt }
        ],
        max_tokens: maxTokens,
        temperature: 0.7,
      }),
    });
  } catch (networkErr) {
    return { status: 'retryable' };
  }

  // 레이트리밋: 429 상태코드 또는 응답 헤더로 판단
  if (response.status === 429) {
    return { status: 'rate_limited' };
  }

  const data = await response.json().catch(() => null);

  if (!response.ok || !data) {
    return { status: 'retryable' };
  }

  if (data.error) {
    const code = data.error.code || data.error?.status;
    const msg = (data.error.message || '').toLowerCase();
    if (code === 429 || msg.includes('rate limit') || msg.includes('too many requests')) {
      return { status: 'rate_limited' };
    }
    return { status: 'retryable' };
  }

  const choice = data?.choices?.[0];
  let text = (choice?.message?.content || '').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  if (!text) return { status: 'retryable' };

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1);
  }

  if (choice?.finish_reason === 'length') {
    return { status: 'retryable' }; // 잘렸으면 다음 시도에서 max_tokens를 늘려 재시도
  }

  try {
    JSON.parse(text);
  } catch {
    return { status: 'retryable' };
  }

  return { status: 'ok', text };
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

  // 시도할 때마다 max_tokens을 조금씩 늘리고, 레이트리밋이면 더 오래 기다렸다가 재시도
  const attempts = [
    { maxTokens: 1500, waitBefore: 0 },
    { maxTokens: 1500, waitBefore: 1500 },
    { maxTokens: 2200, waitBefore: 3000 },
    { maxTokens: 2200, waitBefore: 5000 },
    { maxTokens: 2200, waitBefore: 8000 },
  ];

  for (let i = 0; i < attempts.length; i++) {
    if (attempts[i].waitBefore) await sleep(attempts[i].waitBefore);

    const result = await callOpenRouter(apiKey, prompt, attempts[i].maxTokens);

    if (result.status === 'ok') {
      return res.status(200).json({ content: [{ text: result.text }] });
    }
    // rate_limited / retryable 이면 다음 attempt로 계속 (루프가 알아서 대기 후 재시도)
  }

  // 여기까지 왔다는 건 5번의 실제 재시도가 모두 실패했다는 뜻 — 정직하게 알림
  return res.status(502).json({ error: '여러 번 재시도했지만 AI 응답을 받지 못했습니다. 잠시 후 다시 시도해주세요.' });
}
