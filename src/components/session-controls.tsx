"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { btnGhost } from "@/components/ui";

export function SignOutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  return (
    <button
      type="button"
      className={btnGhost}
      disabled={loading}
      onClick={async () => {
        setLoading(true);
        await authClient.signOut();
        router.replace("/login");
        router.refresh();
      }}
    >
      {loading ? "Keluar…" : "Keluar"}
    </button>
  );
}

export function OrgSwitcher({ orgs, activeId }: { orgs: { id: string; name: string }[]; activeId: string }) {
  const router = useRouter();
  if (orgs.length <= 1) return null;

  return (
    <select
      className="rounded-lg border border-line bg-white px-2 py-1.5 text-xs text-stone-700"
      value={activeId}
      onChange={async (event) => {
        await fetch("/api/switch-org", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId: event.target.value }),
        });
        router.refresh();
      }}
    >
      {orgs.map((org) => (
        <option key={org.id} value={org.id}>
          {org.name}
        </option>
      ))}
    </select>
  );
}
