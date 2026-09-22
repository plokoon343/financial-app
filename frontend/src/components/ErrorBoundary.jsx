import React from 'react';

// App-wide safety net. Without this, any uncaught render error (a bad parse
// shape, an undefined field, a lazy-chunk failure) unmounts the whole React
// tree and the user just sees a blank white screen. This catches it and shows a
// recoverable card instead — with a way to retry, reload, or go home.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // Keep a breadcrumb in the console for support/debugging.
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }

  // Let the boundary recover when the user navigates elsewhere (route change).
  componentDidUpdate(prevProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null });
    }
  }

  handleRetry = () => this.setState({ hasError: false, error: null });

  render() {
    if (!this.state.hasError) return this.props.children;

    const isChunkError = /loading chunk|dynamically imported module|failed to fetch/i
      .test(this.state.error?.message || '');

    return (
      <div style={{
        minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem',
      }}>
        <div style={{
          maxWidth: 440, width: '100%', textAlign: 'center',
          background: 'var(--card-bg, #fff)', border: '1px solid var(--glass-border, rgba(0,0,0,0.08))',
          borderRadius: 18, padding: '2rem 1.5rem', boxShadow: 'var(--shadow-lg, 0 20px 40px rgba(0,0,0,0.12))',
        }}>
          <div style={{ fontSize: '2.4rem', marginBottom: '0.75rem' }} aria-hidden>😕</div>
          <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.25rem', color: 'var(--text-primary, #1a365d)' }}>
            {isChunkError ? 'A fresh version is available' : 'Something went wrong'}
          </h2>
          <p style={{ margin: '0 0 1.25rem', fontSize: '0.92rem', color: 'var(--text-secondary, #718096)', lineHeight: 1.55 }}>
            {isChunkError
              ? 'The app was updated while this page was open. Reload to get the latest version — your data is safe.'
              : 'This screen hit an unexpected error. Your data is safe. Try again, or head back to your dashboard.'}
          </p>
          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            {!isChunkError && (
              <button onClick={this.handleRetry} style={btn('ghost')}>Try again</button>
            )}
            <button onClick={() => window.location.reload()} style={btn('solid')}>Reload app</button>
            <button onClick={() => { window.location.href = '/'; }} style={btn('ghost')}>Go to dashboard</button>
          </div>
          {process.env.NODE_ENV !== 'production' && this.state.error && (
            <pre style={{
              marginTop: '1.25rem', textAlign: 'left', fontSize: '0.72rem', color: '#e53e3e',
              background: 'rgba(229,62,62,0.08)', padding: '0.75rem', borderRadius: 10, overflow: 'auto', maxHeight: 160,
            }}>{String(this.state.error?.stack || this.state.error?.message || this.state.error)}</pre>
          )}
        </div>
      </div>
    );
  }
}

const btn = (kind) => ({
  padding: '0.6rem 1.1rem', borderRadius: 10, fontWeight: 700, fontSize: '0.88rem', cursor: 'pointer',
  border: kind === 'solid' ? 'none' : '1px solid var(--glass-border, rgba(0,0,0,0.12))',
  background: kind === 'solid' ? 'var(--gradient-primary, #008751)' : 'transparent',
  color: kind === 'solid' ? '#fff' : 'var(--text-primary, #1a365d)',
});

export default ErrorBoundary;
