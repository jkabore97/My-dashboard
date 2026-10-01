export function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm rounded-xl border border-line bg-panel p-6">
        <div className="text-xs uppercase tracking-[0.2em] text-muted">Kaj Consulting</div>
        <h1 className="mb-5 text-xl font-semibold">{title}</h1>
        {children}
      </div>
    </main>
  );
}
