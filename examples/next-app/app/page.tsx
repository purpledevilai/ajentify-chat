export default function HomePage() {
  return (
    <div className="mx-auto w-full max-w-3xl flex-1 px-5 py-8">
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Welcome 👋</h1>
      <div className="rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm">
        <p className="leading-relaxed">
          This is a Next.js App Router app demonstrating <code>@ajentify/chat</code>.
        </p>
        <p className="mt-2 leading-relaxed">
          Click <strong>Open chat</strong> in the top-right to slide in the AI panel.
          Try the <strong>Orders</strong> page to see the agent read and act on page
          data via the <code>get_page_data</code> and <code>do_page_action</code> tools.
        </p>
      </div>
    </div>
  );
}
