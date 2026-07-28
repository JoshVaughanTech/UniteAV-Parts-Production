/** Route-level skeleton — shows instantly while server pages fetch data. */
export default function Loading() {
  return (
    <div className="animate-pulse space-y-6" aria-busy>
      <div className="space-y-2">
        <div className="h-6 w-56 rounded-lg bg-surface-2" />
        <div className="h-4 w-80 rounded-lg bg-surface-2" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-20 rounded-xl border bg-surface" />
        ))}
      </div>
      <div className="h-96 rounded-xl border bg-surface" />
    </div>
  );
}
