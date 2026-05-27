export function HomePage() {
  return (
    <div className="page">
      <h1>Welcome 👋</h1>
      <div className="card">
        <p>
          This is a minimal Vite + React app demonstrating <code>@ajentify/chat</code>.
        </p>
        <p>
          Click <strong>Open chat</strong> in the top-right to slide in the AI panel.
          The chat can read and act on the current page via the special
          <code>get_page_data</code> and <code>do_page_action</code> tools — try it on the{' '}
          <strong>Orders</strong> page.
        </p>
      </div>
    </div>
  );
}
