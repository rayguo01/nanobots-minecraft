import Anthropic from '@anthropic-ai/sdk';
import config from '../config.js';
import { validateAction } from './schema.js';

const client = new Anthropic();

export async function getDecision(snapshot, systemPrompt) {
  const userMessage = `当前状态：\n${JSON.stringify(snapshot, null, 2)}\n\n请选择你的行动。以 JSON 格式回复，包含 reasoning、action、params 字段。`;

  let lastError = '';
  for (let attempt = 0; attempt <= config.llm.maxRetries; attempt++) {
    try {
      const content = attempt === 0
        ? userMessage
        : `${userMessage}\n\n上次回复格式有误: ${lastError}。请严格按 JSON 格式回复。`;

      const response = await client.messages.create({
        model: config.llm.model,
        max_tokens: config.llm.maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content }],
      });

      const text = response.content[0].text;
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
