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
        'HTTP-Referer': 'https://localize-site.vercel.app',
      },
      body: JSON.stringify({
        model: 'google/gemma-3-12b-it:free',
        messages: [
          {
            role: 'system',
            content: '당신은 로컬라이징 전문가입니다. 반드시 완전한 JSON만 출력하세요. 마크다운 없이.'
          },
          { role: 'user', content: prompt }
        ],
        max_tokens: 2000,
        temperature: 0.7,
      }),
    });
    const data = await response.json();
    let text = data?.choices?.[0]?.message?.content || '';
    text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return res.status(200).json({ content: [{ text }] });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
