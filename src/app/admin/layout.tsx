import { requireAdmin } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/format";
import { AdminBottomNav, AdminNav } from "@/components/nav";
import { OrgSwitcher, SignOutButton } from "@/components/session-controls";
import { ThemeToggle } from "@/components/theme-toggle";
import { Separator } from "@/components/ui/separator";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { org, user, membership, allMemberships } = await requireAdmin();

  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 md:flex-row">
        <aside className="md:w-60 md:shrink-0 print:hidden">
          <div className="mb-4 flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
              G
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{org.name}</p>
              <p className="text-xs text-muted-foreground">
                {ROLE_LABEL[membership.role] ?? membership.role}
              </p>
            </div>
          </div>

          <div className="mb-3 flex items-center gap-2">
            <OrgSwitcher
              orgs={allMemberships.map((row) => ({ id: row.org.id, name: row.org.name }))}
              activeId={org.id}
            />
            <ThemeToggle />
          </div>

          <AdminNav />
          <div className="hidden md:block">
            <Separator className="my-4" />
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-xs text-muted-foreground">{user.name}</p>
              <SignOutButton />
            </div>
          </div>
        </aside>

        {/* pb-24 memberi ruang untuk bottom navigation di mobile. */}
        <main className="flex min-w-0 flex-1 flex-col gap-5 pb-24 md:pb-10">{children}</main>
      </div>

      <AdminBottomNav />
    </div>
  );
}
