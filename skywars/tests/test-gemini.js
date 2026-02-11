/**
 * test-gemini.js — Quick diagnostic for Gemini API connectivity.
 * Usage: node skywars/tests/test-gemini.js
 *
 * Uses fetch directly (no @google/genai SDK needed).
 */

import config from '../config.js';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

async function main() {
  console.log('[test-gemini] provider:', config.llm.provider);
  console.log('[test-gemini] model:', config.llm.model);
  console.log('[test-gemini] apiKey:', config.llm.apiKey ? config.llm.apiKey.slice(0, 10) + '...' : 'MISSING');

  const url = `${GEMINI_API_BASE}/models/${config.llm.model}:generateContent?key=${config.llm.apiKey}`;
  console.log('[test-gemini] URL:', url.replace(config.llm.apiKey, '***'));

  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: 'Say "hello" in JSON: {"message": "hello"}' }],
      },
    ],
    generationConfig: {
      maxOutputTokens: 64,
    },
  };

  console.log('[test-gemini] sending test request...');
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    console.log('[test-gemini] HTTP status:', res.status);

    const data = await res.json();

    if (!res.ok) {
      console.error('[test-gemini] FAILED!');
      console.error('[test-gemini] Error:', JSON.stringify(data, null, 2));
      return;
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    console.log('[test-gemini] SUCCESS! Response:', text);
  } catch (err) {
    console.error('[test-gemini] NETWORK ERROR:', err.message);
  }
}

main();
