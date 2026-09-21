export function aiProviders(allowGemini) {
  return allowGemini ? ['cloudflare', 'gemini'] : ['cloudflare'];
}

export function AiConsent({ checked, onChange, allowGemini, onGeminiChange, disabled = false, camera = false }) {
  return <div className="ai-processing-consent">
    <label className="ai-consent">
      <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} disabled={disabled}/>
      <span>I am 18 or older and consent to {camera ? 'anonymous room and object references, shot preferences and timing' : 'sanitized planning facts'} being processed by Cloudflare Workers AI. {camera ? 'Drawings, room names and my original text are not sent to AI.' : 'Account details, precise addresses and uploaded files are not sent to AI.'}</span>
    </label>
    <label className="ai-consent">
      <input type="checkbox" checked={allowGemini} onChange={event => onGeminiChange(event.target.checked)} disabled={disabled}/>
      <span>Also allow Google Gemini if Cloudflare is unavailable or its free allowance is used. Google’s free service may review inputs and outputs and use them to improve its products.</span>
    </label>
  </div>;
}
