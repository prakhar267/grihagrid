// Give short physical/keyboard taps a perceptible, bounded step, even when
// keyup arrives between frames. Held controls still move continuously.
export function setWalkingInput(state, key, pressed, cancel = false) {
  state.taps ||= {}
  if (cancel) delete state.taps[key]
  else if (pressed && !state[key]) state.taps[key] = 0.08
  state[key] = pressed
}

export function consumeWalkingInput(state, delta) {
  const seconds = Math.max(0, Math.min(Number(delta) || 0, 0.05))
  const active = key => Boolean(state[key] || state.taps?.[key] > 0)
  const forward = Number(active('forward')) - Number(active('backward'))
  const side = Number(active('right')) - Number(active('left'))
  for (const key of Object.keys(state.taps || {})) {
    state.taps[key] = Math.max(0, state.taps[key] - seconds)
    if (!state.taps[key]) delete state.taps[key]
  }
  return { forward, side, seconds }
}
