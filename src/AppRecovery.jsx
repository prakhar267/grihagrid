import { Component, createRef, useEffect, useRef } from "react";

const reloadWarning = "Reload GrihaGrid? Unsaved changes in this tab may be lost. Saved projects will remain available.";

export class AppErrorBoundary extends Component {
  state = { failed: false };
  heading = createRef();

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.heading.current?.focus({ preventScroll: true });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="error-page" aria-labelledby="app-recovery-title">
      <span className="kicker">GrihaGrid · page recovery</span>
      <h1 id="app-recovery-title" ref={this.heading} tabIndex="-1">This page could not be opened.</h1>
      <p role="alert">A part of the app could not load or stopped working. Check your connection, then reload when you are ready.</p>
      <p id="app-recovery-warning">Unsaved changes in this tab may be lost when you reload. Saved projects remain available. No action has been retried automatically.</p>
      <button type="button" className="copper-button" aria-describedby="app-recovery-warning" onClick={() => {
        if (window.confirm(reloadWarning)) window.location.reload();
      }}>Reload app</button>
    </main>;
  }
}

export function SessionBootstrapRecovery({ failed, onRetry, onHome }) {
  const heading = useRef(null);
  useEffect(() => { if (failed) heading.current?.focus({ preventScroll: true }); }, [failed]);
  return <main className="error-page" aria-labelledby="session-recovery-title" aria-busy={!failed}>
    <span className="kicker">Private workspace</span>
    <h1 id="session-recovery-title" ref={heading} tabIndex="-1">{failed ? "We could not confirm your session." : "Checking your session…"}</h1>
    <p role={failed ? "alert" : "status"}>{failed ? "The connection check failed. This does not mean you were signed out. Your private workspace will open only after your session is confirmed." : "No private account controls are shown until this session is confirmed."}</p>
    {failed && <button type="button" className="copper-button" onClick={onRetry}>Retry session check</button>}
    <button type="button" className="outline-button" onClick={onHome}>Return home</button>
  </main>;
}
