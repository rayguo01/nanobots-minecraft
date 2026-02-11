import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import config from '../config.js';
import { validateAction } from './schema.js';

// --- Provider clients (lazy init) ---
let anthropicClient = null;
let geminiClient = null;

function getAnthropicClient() {
  if (!anthropicClient) anthropicClient = new Anthropic({ apiKey: config.llm.apiKey });
  return anthropicClient;
}

function getGeminiClient() {
  if (!geminiClient) geminiClient = new GoogleGenAI({ apiKey: config.llm.apiKey });
  return geminiClient;
}

// --- Provider-specific call implementations ---

async function callAnthropic(systemPrompt, userContent) {
  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: config.llm.model,
    max_tokens: config.llm.maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userContent }],
  });
  return response.content[0].text;
}

async function callGemini(systemPrompt, userContent) {
  const client = getGeminiClient();
  const response = await client.models.generateContent({
    model: config.llm.model,
    contents: userContent,
    config: {
      systemInstruction: systemPrompt,
      maxOutputTokens: config.llm.maxTokens,
    },
  });
  return response.text;
}

// --- Main entry ---

const providers = {
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
      console.log(`[llm-client] attempt ${attempt} failed: ${err.message}`);
      lastError = err.message;
    }
  }

  // Fallback to wait
  console.log('[llm-client] all attempts failed, defaulting to wait');
  return { reasoning: 'LLM error, defaulting to wait', action: 'wait', params: {} };
}
