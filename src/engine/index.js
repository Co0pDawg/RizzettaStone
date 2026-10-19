import { createRuleConverter } from './ruleConverter.js';
import { createLlmConverter } from './llmConverter.js';

/**
 * One rewrite made during a conversion.
 * @typedef {{ from: string, to: string, kind: 'laugh' | 'lexicon' | 'style' }} Change
 */

/**
 * @typedef {{ text: string, changes: Change[] }} ConvertResult
 */

/**
 * Every converter, rules or LLM, satisfies this interface. `convert` is async
 * so a network-backed implementation can share the same signature.
 * @typedef {{
 *   mode: 'rules' | 'llm',
 *   convert: (text: string, opts: { from: string, to: string }) => Promise<ConvertResult>,
 * }} Converter
 */

/**
 * Create a converter.
 * @param {{ mode?: 'rules' | 'llm', [option: string]: unknown }} [options]
 *   `mode` defaults to 'rules'. Remaining options go to the implementation
 *   (rules: `dictionaries`, `concepts`; llm: see llmConverter.js).
 * @returns {Converter}
 */
export function createConverter(options = {}) {
  const { mode = 'rules', ...rest } = options;
  if (mode === 'rules') return createRuleConverter(rest);
  if (mode === 'llm') return createLlmConverter(rest);
  throw new Error(`Unknown converter mode "${mode}"`);
}

export { GENERATION_IDS, DICTIONARIES, CONCEPTS, validateDictionary, validateAll } from './dictionaries.js';
