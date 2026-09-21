// Keep model choice and token bounds together: changing either requires a new
// free-allocation calculation, provider verification and a reviewed release.
export const CLOUDFLARE_AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
export const CLOUDFLARE_MAX_INPUT_BYTES = 12_000;
export const CLOUDFLARE_MAX_OUTPUT_TOKENS = 1600;
export const CLOUDFLARE_NEURONS_PER_CALL = 700;

export function createCloudflareAi(HttpError) {
  function config(env) {
    const model = String(env.CLOUDFLARE_AI_MODEL || CLOUDFLARE_AI_MODEL).trim();
    if (model !== CLOUDFLARE_AI_MODEL) throw new HttpError(503, 'AI model configuration is invalid', 'ai_unavailable');
    dailyLimit(env);
    if (typeof env.AI?.run !== 'function') return null;
    return { provider: 'cloudflare', model };
  }

  function dailyLimit(env) {
    const maximum = env.APP_ENV === 'staging' ? 2800 : 5600;
    const value = env.CLOUDFLARE_AI_DAILY_NEURONS === undefined ? maximum : Number(env.CLOUDFLARE_AI_DAILY_NEURONS);
    if (!Number.isSafeInteger(value) || value < CLOUDFLARE_NEURONS_PER_CALL || value > maximum) throw new HttpError(503, 'AI allocation is misconfigured', 'ai_unavailable');
    return value;
  }

  function request(prompt, schema) {
    const input = {
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_schema', json_schema: schema },
      max_tokens: CLOUDFLARE_MAX_OUTPUT_TOKENS,
      temperature: 0.1,
      stream: false,
    };
    // UTF-8 bytes conservatively bound byte-level tokenizer input, including
    // the schema; reserve extra template overhead in the 700-neuron allowance.
    if (new TextEncoder().encode(JSON.stringify(input)).byteLength > CLOUDFLARE_MAX_INPUT_BYTES) {
      throw new HttpError(503, 'This AI request exceeds the free model input limit', 'ai_capacity_unavailable');
    }
    return input;
  }

  async function run(env, model, input, validate, timeoutMs = 20_000) {
    let timer;
    let result;
    try {
      // The binding cannot cancel work already admitted remotely. A timed-out
      // call keeps its full reservation; it is never retried on Cloudflare.
      result = await Promise.race([
        Promise.resolve().then(() => env.AI.run(model, input)),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); }),
      ]);
    } catch {
      throw new HttpError(503, 'Cloudflare AI is temporarily unavailable', 'ai_capacity_unavailable');
    } finally { clearTimeout(timer); }
    try {
      const raw = result?.response;
      if (raw == null || new TextEncoder().encode(typeof raw === 'string' ? raw : JSON.stringify(raw)).byteLength > 65_536) throw new Error('invalid response');
      const content = validate(typeof raw === 'string' ? JSON.parse(raw) : raw);
      const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000 ? value : null;
      const usage = {
        inputTokens: count(result.usage?.prompt_tokens),
        outputTokens: count(result.usage?.completion_tokens),
        thoughtTokens: null,
        totalTokens: count(result.usage?.total_tokens),
      };
      return { content, provider: 'cloudflare', model, interactionId: null,
        usage: Object.values(usage).some(value => value !== null) ? usage : null };
    } catch {
      // Never show, log, repair or fall back from an unvalidated answer.
      throw new HttpError(502, 'AI output could not be validated. Your saved work is unchanged.', 'ai_provider_error');
    }
  }
  return { config, dailyLimit, request, run };
}
