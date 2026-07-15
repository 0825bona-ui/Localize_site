export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  // 2026-07 기준 OpenRouter에 살아있는 무료(:free) 모델들.
  // 맨 앞 모델이 죽었거나(모델 자체가 사라짐), 막혔거나(429 rate limit),
  // 응답이 비정상이면 자동으로 다음 모델로 넘어간다.
  // ※ 무료 모델 라인업은 OpenRouter가 수시로 교체하니, 다시 502가 나면
  //   https://openrouter.ai/models?order=top-weekly 에서 ":free" 로 필터링해
  //   살아있는 모델 id로 이 배열만 갱신하면 된다.
  const MODEL_FALLBACKS = [
    'meta-llama/llama-3.3-70b-instruct:free',
    'openai/gpt-oss-20b:free',
    'qwen/qwen3-next-80b-a3b-instruct:free',
    'openai/gpt-oss-120b:free',
  ];

  let lastError = null;

  for (const model of MODEL_FALLBACKS) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          // 없어도 동작하지만, OpenRouter 대시보드에서 요청 출처를 식별하는 데 도움됨
          'HTTP-Referer': 'https://localize-app.vercel.app',
          'X-Title': 'Localize',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 1000,
        }),
      });

      const data = await response.json();

      // OpenRouter가 에러를 반환한 경우(모델이 사라짐/rate limit 등) 감지 → 다음 모델로 폴백
      if (!response.ok || data.error) {
        const errMsg = data?.error?.message || `OpenRouter error (${response.status})`;
        lastError = { status: response.status, message: errMsg };
        continue; // 다음 폴백 모델 시도
      }

      const text = data?.choices?.[0]?.message?.content || '';
      if (!text) {
        lastError = { status: 502, message: '모델 응답이 비었습니다.' };
        continue;
      }

      // 성공 — 어떤 모델이 응답했는지 참고용으로 같이 내려준다
      return res.status(200).json({ content: [{ text }], model_used: model });
    } catch (error) {
      lastError = { status: 500, message: error.message };
      // 네트워크 에러 등도 다음 모델로 폴백
      continue;
    }
  }

  // 모든 폴백 모델이 실패한 경우
  return res.status(lastError?.status || 502).json({
    error: lastError?.message || '모든 모델 호출에 실패했습니다.',
  });
}
