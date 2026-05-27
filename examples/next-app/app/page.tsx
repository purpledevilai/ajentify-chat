export default function HomePage() {
  return (
    <div className="page">
      <h1>Welcome 👋</h1>
      <div className="card">
        <p>
          This is a Next.js App Router app demonstrating <code>@ajentify/chat</code>.
        </p>
        <p>
          Click <strong>Open chat</strong> in the top-right to slide in the AI panel.
          Try the <strong>Orders</strong> page to see the agent read and act on page
          data via the <code>get_page_data</code> and <code>do_page_action</code> tools.
        </p>
      </div>
    </div>
  );
}
