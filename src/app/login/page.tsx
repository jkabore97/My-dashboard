export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form action="/api/login" method="post" className="w-full max-w-sm rounded-xl border border-line bg-panel p-6">
        <div className="text-xs uppercase tracking-[0.2em] text-muted">Kaj Consulting</div>
        <h1 className="mb-5 text-xl font-semibold">Command Center</h1>
        <label className="mb-1 block text-sm text-muted" htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoFocus required className="w-full rounded-lg border border-line bg-bg px-3 py-2 outline-none focus:border-accent" />
        {error && <p className="mt-2 text-sm text-critical">Wrong password.</p>}
        <button className="mt-4 w-full rounded-lg bg-accent px-3 py-2 font-medium text-bg hover:opacity-90">Sign in</button>
      </form>
    </main>
  );
}
