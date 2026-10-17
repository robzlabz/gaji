"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOutIcon } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function SignOutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={loading}
      onClick={async () => {
        setLoading(true);
        await authClient.signOut();
        router.replace("/login");
        router.refresh();
      }}
    >
      <LogOutIcon />
      {loading ? "Keluar…" : "Keluar"}
    </Button>
  );
}

export function OrgSwitcher({
  orgs,
  activeId,
}: {
  orgs: { id: string; name: string }[];
  activeId: string;
}) {
  const router = useRouter();
  if (orgs.length <= 1) return null;

  return (
    <Select
      value={activeId}
      onValueChange={async (orgId) => {
        await fetch("/api/switch-org", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId }),
        });
        router.refresh();
      }}
    >
      <SelectTrigger className="w-full" size="sm" aria-label="Pilih organisasi">
        <SelectValue placeholder="Pilih organisasi" />
      </SelectTrigger>
      <SelectContent>
        {orgs.map((org) => (
          <SelectItem key={org.id} value={org.id}>
            {org.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
