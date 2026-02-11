import config from '../config.js';
import { validateAction } from './schema.js';

// --- OpenAI REST API (no SDK dependency) ---

async function callOpenAI(systemPrompt, userContent) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.llm.apiKey}`,
    },
    body: JSON.stringify({
      model: config.llm.model,
      max_tokens: config.llm.maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI API ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error(`OpenAI: empty response - ${JSON.stringify(data).slice(0, 200)}`);
  }
  return text;
}

// --- Gemini REST API ---

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

async function callGemini(systemPrompt, userContent) {
  const url = `${GEMINI_API_BASE}/models/${config.llm.model}:generateContent?key=${config.llm.apiKey}`;

  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userContent }] }],
    generationConfig: { maxOutputTokens: config.llm.maxTokens },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error(`Gemini: empty response - ${JSON.stringify(data).slice(0, 200)}`);
  }
  return text;
}

// --- Anthropic (keep SDK for this one) ---

let anthropicClient = null;

async function callAnthropic(systemPrompt, userContent) {
  if (!anthropicClient) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    anthropicClient = new Anthropic({ apiKey: config.llm.apiKey });
  }
  const response = await anthropicClient.messages.create({
    model: config.llm.model,
    max_tokens: config.llm.maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userContent }],
  });
  return response.content[0].text;
}

// --- Main entry ---

const providers = {
  openai: callOpenAI,
  anthropic: callAnthropic,
  gemini: callGemini,
};

export async function getDecision(snapshot, systemPrompt) {
  const provider = providers[config.llm.provider];
  if (!provider) {
    console.log(`[llm-client] unknown provider: ${config.llm.provider}, defaulting to wait`);
    return { reasoning: 'unknown LLM provider', action: 'wait', params: {} };
  }

  const userMessage = `当前状态：\n${JSON.stringify(snapshot, null, 2)}\n\n请选择你的行动。以 JSON 格式回复，包含 reasoning、action、params 字段。`;

  let lastError = '';
  for (let attempt = 0; attempt <= config.llm.maxRetries; attempt++) {
    try {
      const content = attempt === 0
        ? userMessage
        : `${userMessage}\n\n上次回复格式有误: ${lastError}。请严格按 JSON 格式回复。`;

      const text = await provider(systemPrompt, content);

      // Extract JSON from response (may be wrapped in markdown code block)
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        lastError = 'no JSON found in response';
        continue;
      }

      const decision = JSON.parse(jsonMatch[0]);
      const validation = validateAction(decision);
      if (!validation.valid) {
        lastError = validation.error;
        continue;
      }

      return decision;
    } catch (err) {
      console.log(`[llm-client] attempt ${attempt} failed: ${err.message?.slice(0, 300)}`);
      lastError = err.message;
    }
  }

  // Fallback to wait
  console.log('[llm-client] all attempts failed, defaulting to wait');
  return { reasoning: 'LLM error, defaulting to wait', action: 'wait', params: {} };
}
