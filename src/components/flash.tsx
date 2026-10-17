export function Flash({ ok, err }: { ok?: string; err?: string }) {
  if (!ok && !err) return null;
  return (
    <div
      className={
        err
          ? "rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          : "rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
      }
      role="status"
    >
      {err ?? ok}
    </div>
  );
}
