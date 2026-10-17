import { requireEmployee } from "@/lib/session";
import { EmployeeNav } from "@/components/nav";
import { SignOutButton } from "@/components/session-controls";
import { ThemeToggle } from "@/components/theme-toggle";
import { PAY_TYPE_LABEL, rupiah, toNumber } from "@/lib/format";

export default async function EmployeeLayout({ children }: { children: React.ReactNode }) {
  const { org, employee } = await requireEmployee();

  return (
    <div className="min-h-dvh bg-background pb-20">
      <header className="border-b bg-card print:hidden">
        <div className="mx-auto flex max-w-md items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{employee.fullName}</p>
            <p className="truncate text-xs text-muted-foreground">
              {org.name} · {PAY_TYPE_LABEL[employee.payType]} · {rupiah(toNumber(employee.payRate))}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-4">{children}</main>
      <EmployeeNav />
    </div>
  );
}
