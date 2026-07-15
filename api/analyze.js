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

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'meta-llama/llama-3.1-8b-instruct:free',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1000,
      }),
    });

    const data = await response.json();

    // OpenRouter가 에러를 반환한 경우 감지
    if (!response.ok || data.error) {
      const errMsg = data?.error?.message || `OpenRouter error (${response.status})`;
      return res.status(502).json({ error: errMsg });
    }

    const text = data?.choices?.[0]?.message?.content || '';
    if (!text) return res.status(502).json({ error: '모델 응답이 비었습니다.' });

    return res.status(200).json({ content: [{ text }] });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
