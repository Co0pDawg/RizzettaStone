/**
 * LLM mode: interface stub only. Nothing here makes a network call.
 *
 * Contract a future implementation must satisfy:
 * - Same signature as every Converter:
 *   `convert(text, { from, to }) => Promise<{ text, changes }>`, where each
 *   change is `{ from, to, kind: 'laugh' | 'lexicon' | 'style' }`.
 * - Provider, model, and API key come from `createConverter({ mode: 'llm', ... })`
 *   options (for example `{ provider, model, apiKey }`). Never hard-code them.
 * - It receives the generation dictionaries (`options.dictionaries`, defaulting
 *   to the shipped ones) and passes them to the model as style guidance.
 * - On any error (network, quota, malformed reply) it falls back to the rules
 *   converter and returns that result.
 *
 * @param {{ provider?: string, model?: string, apiKey?: string, dictionaries?: object }} [_options]
 * @returns {import('./index.js').Converter}
 */
export function createLlmConverter(_options = {}) {
  return {
    mode: 'llm',
    async convert() {
      throw new Error('LLM mode is not implemented yet');
    },
  };
}
