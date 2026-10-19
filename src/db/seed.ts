/**
 * Seed demo: 2 tenant, 4 tipe penggajian, kontrak (termasuk yang hampir habis),
 * absensi approved, tugas, kasbon, dan saldo prabayar + ongkos kedatangan.
 *
 * Jalankan: npm run db:seed
 */
import { eq } from "drizzle-orm";
import { db } from "./index";
import {
  cashAdvanceTxns,
  cashAdvances,
  contracts,
  employees,
  leaves,
  memberships,
  organizations,
  payRateHistory,
  timeEntries,
  user,
  wageFloatTxns,
  wageFloats,
  workTasks,
} from "./schema";
import { auth } from "@/lib/auth";
import { leaveWorkDays } from "@/lib/leave";
import { accrualForEntry } from "@/lib/saldo";
import { workedMinutes } from "@/lib/payroll";

function iso(offsetDays: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function at(dateISO: string, hour: number, minute = 0): Date {
  return new Date(`${dateISO}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+07:00`);
}

function weekdaysBack(count: number): string[] {
  const out: string[] = [];
  let offset = -1;
  while (out.length < count) {
    const day = iso(offset);
    const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
    if (dow !== 0) out.push(day);
    offset -= 1;
  }
  return out.reverse();
}

async function ensureUser(input: { name: string; phone: string; pin: string; email: string }) {
  const existing = await db.select().from(user).where(eq(user.phoneNumber, input.phone)).limit(1);
  if (existing[0]) return existing[0].id;

  const created = await auth.api.signUpEmail({
    body: { email: input.email, password: input.pin, name: input.name },
  });
  if (!created?.user?.id) throw new Error(`gagal membuat user ${input.phone}`);

  await db
    .update(user)
    .set({ phoneNumber: input.phone, phoneNumberVerified: true })
    .where(eq(user.id, created.user.id));

  return created.user.id;
}

async function main() {
  console.log("→ seed mulai");

  const ownerId = await ensureUser({
    name: "Robbyn Owner",
    phone: "628111111111",
    pin: "111111",
    email: "owner@kopisenja.test",
  });

  for (const slug of ["kopi-senja", "bakery-pagi"]) {
    const [existing] = await db.select().from(organizations).where(eq(organizations.slug, slug)).limit(1);
    if (existing) {
      await db.delete(organizations).where(eq(organizations.id, existing.id));
      console.log(`  · tenant ${slug} lama dihapus`);
    }
  }

  /* ---------------------------- tenant 1 ---------------------------- */
  const [kopi] = await db
    .insert(organizations)
    .values({
      name: "Kopi Senja",
      slug: "kopi-senja",
      payPeriodStartDay: 26,
      contractAlertDays: 45,
      workingDaysPerMonth: 24,
      overtimeMultiplier: "1.50",
      geofenceLat: -6.2088,
      geofenceLng: 106.8456,
      geofenceRadiusM: 200,
    })
    .returning();

  await db.insert(memberships).values({ orgId: kopi.id, userId: ownerId, role: "owner" });

  const staff = [
    // Budi: per jam + ongkos kedatangan + dibayar pakai saldo (kasus owner di Bantul).
    { name: "Budi Santoso", phone: "628222222222", pin: "222222", payType: "hourly", rate: "30000", transport: "10000", code: "KS-001", joined: iso(-120) },
    { name: "Sari Dewi", phone: "628333333333", pin: "333333", payType: "daily", rate: "175000", transport: "0", code: "KS-002", joined: iso(-90) },
    { name: "Andi Pratama", phone: "628444444444", pin: "444444", payType: "monthly", rate: "6000000", transport: "0", code: "KS-003", joined: iso(-200) },
    { name: "Rina Wulandari", phone: "628555555555", pin: "555555", payType: "per_task", rate: "20000", transport: "0", code: "KS-004", joined: iso(-45) },
  ];

  const created: Record<string, { employeeId: string; userId: string }> = {};

  for (const person of staff) {
    const userId = await ensureUser({
      name: person.name,
      phone: person.phone,
      pin: person.pin,
      email: `${person.phone}@kopisenja.test`,
    });

    const [employee] = await db
      .insert(employees)
      .values({
        orgId: kopi.id,
        userId,
        code: person.code,
        fullName: person.name,
        payType: person.payType,
        payRate: person.rate,
        transportRate: person.transport,
        joinedAt: person.joined,
      })
      .returning();

    await db.insert(memberships).values({ orgId: kopi.id, userId, role: "employee" });
    await db.insert(payRateHistory).values({
      employeeId: employee.id,
      kind: "wage",
      payType: person.payType,
      payRate: person.rate,
      effectiveFrom: person.joined,
    });
    if (person.transport !== "0") {
      await db.insert(payRateHistory).values({
        employeeId: employee.id,
        kind: "transport",
        payType: person.payType,
        payRate: person.transport,
        effectiveFrom: person.joined,
      });
    }
    created[person.name] = { employeeId: employee.id, userId };
  }

  /* ---------------------------- kontrak ----------------------------- */
  await db.insert(contracts).values([
    {
      orgId: kopi.id,
      employeeId: created["Budi Santoso"].employeeId,
      kind: "pkwt",
      startDate: iso(-120),
      endDate: iso(20),
      payType: "hourly",
      payRate: "30000",
      contractNo: "001/PKWT/KS/2026",
      note: "Kontrak barista — akan segera berakhir.",
    },
    {
      orgId: kopi.id,
      employeeId: created["Sari Dewi"].employeeId,
      kind: "pkwt",
      startDate: iso(-90),
      endDate: iso(180),
      payType: "daily",
      payRate: "175000",
      contractNo: "002/PKWT/KS/2026",
    },
    {
      orgId: kopi.id,
      employeeId: created["Andi Pratama"].employeeId,
      kind: "pkwtt",
      startDate: iso(-200),
      endDate: null,
      payType: "monthly",
      payRate: "6000000",
      contractNo: "003/PKWTT/KS/2026",
    },
    {
      orgId: kopi.id,
      employeeId: created["Rina Wulandari"].employeeId,
      kind: "probation",
      startDate: iso(-45),
      endDate: iso(10),
      payType: "per_task",
      payRate: "20000",
      contractNo: "004/PROB/KS/2026",
      note: "Masa percobaan 3 bulan.",
    },
  ]);

  /* ---------------------------- absensi ----------------------------- */
  const budiDays = weekdaysBack(8);
  const sariDays = weekdaysBack(6);

  for (const day of budiDays) {
    await db.insert(timeEntries).values({
      orgId: kopi.id,
      employeeId: created["Budi Santoso"].employeeId,
      workDate: day,
      clockInAt: at(day, 8),
      clockOutAt: at(day, 16, 30),
      breakMinutes: 60,
      overtimeMinutes: 0,
      status: "approved",
      source: "pwa",
      withinGeofence: true,
      approvedAt: new Date(),
    });
  }

  // satu entri dengan lembur + foto dummy tidak disertakan
  const overtimeDay = iso(-2);
  await db.insert(timeEntries).values({
    orgId: kopi.id,
    employeeId: created["Budi Santoso"].employeeId,
    workDate: overtimeDay,
    clockInAt: at(overtimeDay, 8),
    clockOutAt: at(overtimeDay, 19),
    breakMinutes: 60,
    overtimeMinutes: 120,
    overtimeNote: "Bantu tutup outlet + stok opname",
    status: "approved",
    source: "pwa",
    withinGeofence: true,
    approvedAt: new Date(),
  });

  // satu entri pending untuk demo approval
  const pendingDay = iso(0);
  await db.insert(timeEntries).values({
    orgId: kopi.id,
    employeeId: created["Budi Santoso"].employeeId,
    workDate: pendingDay,
    clockInAt: at(pendingDay, 8),
    clockOutAt: at(pendingDay, 12),
    breakMinutes: 0,
    status: "pending",
    source: "pwa",
  });

  for (const day of sariDays) {
    await db.insert(timeEntries).values({
      orgId: kopi.id,
      employeeId: created["Sari Dewi"].employeeId,
      workDate: day,
      clockInAt: at(day, 9),
      clockOutAt: at(day, 17),
      breakMinutes: 60,
      status: "approved",
      source: "pwa",
    });
  }

  /* ----------------------- saldo + ongkos Budi ---------------------- */
  // Budi dibayar dengan sistem saldo: owner kirim uang dulu, tiap kehadiran approved
  // memotong saldo sebesar upah jam + ongkos kedatangan.
  const budiEntries = await db
    .select()
    .from(timeEntries)
    .where(eq(timeEntries.employeeId, created["Budi Santoso"].employeeId));

  const [budiFloat] = await db
    .insert(wageFloats)
    .values({ orgId: kopi.id, employeeId: created["Budi Santoso"].employeeId, balance: "0" })
    .returning();

  const topUpAmount = 2_400_000;
  await db.insert(wageFloatTxns).values([
    {
      orgId: kopi.id,
      floatId: budiFloat.id,
      kind: "topup",
      amount: "1500000",
      occurredAt: iso(-10),
      note: "Transfer BCA — uang muka gaji Budi",
    },
    {
      orgId: kopi.id,
      floatId: budiFloat.id,
      kind: "topup",
      amount: "900000",
      occurredAt: iso(-4),
      note: "Transfer BCA — tambahan saldo",
    },
  ]);

  let budiBalance = topUpAmount;
  for (const entry of budiEntries) {
    if (entry.status !== "approved") continue;
    const minutes = workedMinutes({
      id: entry.id,
      workDate: entry.workDate,
      clockInAt: entry.clockInAt,
      clockOutAt: entry.clockOutAt,
      breakMinutes: entry.breakMinutes,
      overtimeMinutes: entry.overtimeMinutes,
    });
    const breakdown = accrualForEntry({
      minutes,
      overtimeMinutes: entry.overtimeMinutes,
      rate: 30000,
      transportAmount: 10000,
      overtimeMultiplier: 1.5,
    });
    if (breakdown.total <= 0) continue;

    await db
      .update(timeEntries)
      .set({ transportAmount: "10000" })
      .where(eq(timeEntries.id, entry.id));
    await db.insert(wageFloatTxns).values({
      orgId: kopi.id,
      floatId: budiFloat.id,
      kind: "accrual",
      amount: (-breakdown.total).toString(),
      wageAmount: breakdown.wageAmount.toString(),
      transportAmount: breakdown.transportAmount.toString(),
      minutes,
      rateUsed: "30000",
      occurredAt: entry.workDate,
      sourceTable: "time_entries",
      sourceId: entry.id,
      note: `Upah ${Math.floor(minutes / 60)}j ${minutes % 60}m + ongkos`,
    });
    budiBalance -= breakdown.total;
  }

  await db
    .update(wageFloats)
    .set({ balance: budiBalance.toString() })
    .where(eq(wageFloats.id, budiFloat.id));

  /* ----------------------------- tugas ------------------------------ */
  const taskDays = weekdaysBack(5);
  await db.insert(workTasks).values([
    {
      orgId: kopi.id,
      employeeId: created["Rina Wulandari"].employeeId,
      title: "Jahit 20 pcs celemek",
      qty: "20",
      unit: "pcs",
      unitRate: "20000",
      status: "approved",
      workDate: taskDays[0],
      approvedAt: new Date(),
    },
    {
      orgId: kopi.id,
      employeeId: created["Rina Wulandari"].employeeId,
      title: "Sablon 15 pcs tote bag",
      qty: "15",
      unit: "pcs",
      unitRate: "20000",
      status: "approved",
      workDate: taskDays[1],
      approvedAt: new Date(),
    },
    {
      orgId: kopi.id,
      employeeId: created["Rina Wulandari"].employeeId,
      title: "Perbaiki 5 seragam",
      qty: "5",
      unit: "pcs",
      unitRate: "20000",
      status: "done",
      workDate: taskDays[2],
      doneAt: new Date(),
    },
    {
      orgId: kopi.id,
      employeeId: created["Rina Wulandari"].employeeId,
      title: "Buat 10 taplak meja",
      qty: "10",
      unit: "pcs",
      unitRate: "20000",
      status: "open",
      workDate: taskDays[3],
    },
  ]);

  /* ----------------------------- cuti ------------------------------- */
  // Cuti hanya untuk karyawan bulanan: Andi (monthly). Satu disetujui (berbayar),
  // satu menunggu approval supaya halaman admin punya contoh keputusan.
  const leaveApprovedStart = iso(-3);
  const leaveApprovedEnd = iso(-2);
  const leavePendingStart = iso(3);
  const leavePendingEnd = iso(4);

  await db.insert(leaves).values([
    {
      orgId: kopi.id,
      employeeId: created["Andi Pratama"].employeeId,
      kind: "cuti",
      startDate: leaveApprovedStart,
      endDate: leaveApprovedEnd,
      days: leaveWorkDays(leaveApprovedStart, leaveApprovedEnd),
      paid: true,
      status: "approved",
      note: "Acara keluarga di luar kota",
      approvedAt: new Date(),
    },
    {
      orgId: kopi.id,
      employeeId: created["Andi Pratama"].employeeId,
      kind: "izin",
      startDate: leavePendingStart,
      endDate: leavePendingEnd,
      days: leaveWorkDays(leavePendingStart, leavePendingEnd),
      paid: true,
      status: "pending",
      note: "Urus dokumen kendaraan",
    },
  ]);

  /* ----------------------------- kasbon ----------------------------- */
  const [advance] = await db
    .insert(cashAdvances)
    .values({
      orgId: kopi.id,
      employeeId: created["Budi Santoso"].employeeId,
      principal: "1000000",
      balance: "1000000",
      installmentAmount: "250000",
      requestedAt: iso(-10),
      status: "approved",
      approvedAt: new Date(),
      note: "Biaya perbaikan motor",
    })
    .returning();

  await db.insert(cashAdvanceTxns).values({
    cashAdvanceId: advance.id,
    kind: "disburse",
    amount: "1000000",
    occurredAt: iso(-10),
    note: "Pencairan kasbon",
  });

  await db.insert(cashAdvances).values({
    orgId: kopi.id,
    employeeId: created["Sari Dewi"].employeeId,
    principal: "500000",
    balance: "500000",
    installmentAmount: null,
    requestedAt: iso(-1),
    status: "pending",
    note: "Kebutuhan sekolah",
  });

  /* ---------------------------- tenant 2 ---------------------------- */
  const [bakery] = await db
    .insert(organizations)
    .values({
      name: "Bakery Pagi",
      slug: "bakery-pagi",
      payPeriodStartDay: 1,
      contractAlertDays: 30,
      workingDaysPerMonth: 26,
    })
    .returning();

  await db.insert(memberships).values({ orgId: bakery.id, userId: ownerId, role: "owner" });

  const bakeryUserId = await ensureUser({
    name: "Tono Baker",
    phone: "628666666666",
    pin: "666666",
    email: "tono@bakerypagi.test",
  });

  const [tono] = await db
    .insert(employees)
    .values({
      orgId: bakery.id,
      userId: bakeryUserId,
      code: "BP-001",
      fullName: "Tono Baker",
      payType: "daily",
      payRate: "160000",
      joinedAt: iso(-30),
    })
    .returning();

  await db.insert(memberships).values({ orgId: bakery.id, userId: bakeryUserId, role: "employee" });

  await db.insert(contracts).values({
    orgId: bakery.id,
    employeeId: tono.id,
    kind: "pkwt",
    startDate: iso(-30),
    endDate: iso(15),
    payType: "daily",
    payRate: "160000",
    contractNo: "001/PKWT/BP/2026",
  });

  console.log("✓ seed selesai");
  console.log("  Owner : 08111111111 / PIN 111111 (akses 2 tenant)");
  console.log("  Budi  : 08222222222 / PIN 222222 (hourly)");
  console.log("  Sari  : 08333333333 / PIN 333333 (daily)");
  console.log("  Andi  : 08444444444 / PIN 444444 (monthly)");
  console.log("  Rina  : 08555555555 / PIN 555555 (per_task)");
  console.log("  Tono  : 08666666666 / PIN 666666 (Bakery Pagi, daily)");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
