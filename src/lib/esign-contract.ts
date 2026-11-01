import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { contractSignatures, contracts, employees, organizations } from "@/db/schema";
import type { ContractSummary } from "@/lib/esign";

export type SignatureRow = typeof contractSignatures.$inferSelect;
type ContractRow = typeof contracts.$inferSelect;

/** Ringkasan kontrak yang dibekukan oleh hash; dipakai halaman publik & bukti. */
export type SignatureContext = {
  signature: SignatureRow;
  contract: ContractRow;
  employeeName: string;
  orgName: string;
  orgTimezone: string;
};

/**
 * Ambil satu tautan tanda tangan beserta kontrak dan pihaknya.
 * Bentuk token sudah divalidasi pemanggil (`isSignTokenShape`), jadi fungsi ini
 * hanya untuk token yang memang mirip token aplikasi.
 */
export async function findSignatureByToken(token: string): Promise<SignatureContext | null> {
  const [row] = await db
    .select({
      signature: contractSignatures,
      contract: contracts,
      employeeName: employees.fullName,
      orgName: organizations.name,
      orgTimezone: organizations.timezone,
    })
    .from(contractSignatures)
    .innerJoin(contracts, eq(contractSignatures.contractId, contracts.id))
    .innerJoin(employees, eq(contracts.employeeId, employees.id))
    .innerJoin(organizations, eq(contractSignatures.orgId, organizations.id))
    .where(eq(contractSignatures.token, token))
    .limit(1);

  return row ?? null;
}

/** Tautan terbaru milik satu kontrak (semua status), selalu dibatasi organisasi. */
export async function findSignatureForContract(
  orgId: string,
  contractId: string,
): Promise<SignatureRow | null> {
  const [row] = await db
    .select()
    .from(contractSignatures)
    .where(
      and(eq(contractSignatures.orgId, orgId), eq(contractSignatures.contractId, contractId)),
    )
    .orderBy(desc(contractSignatures.createdAt))
    .limit(1);

  return row ?? null;
}

/** Tanda tangan yang benar-benar sudah dipakai — dasar halaman bukti & peringatan. */
export async function findSignedSignature(
  orgId: string,
  contractId: string,
): Promise<SignatureRow | null> {
  const [row] = await db
    .select()
    .from(contractSignatures)
    .where(
      and(
        eq(contractSignatures.orgId, orgId),
        eq(contractSignatures.contractId, contractId),
        eq(contractSignatures.status, "signed"),
      ),
    )
    .orderBy(desc(contractSignatures.signedAt))
    .limit(1);

  return row ?? null;
}

/** Isi kontrak apa adanya saat ini — input untuk hash pembanding. */
export function summaryOf(
  contract: Pick<
    ContractRow,
    "contractNo" | "kind" | "startDate" | "endDate" | "payType" | "payRate"
  >,
  employeeName: string,
  orgName: string,
): ContractSummary {
  return {
    contractNo: contract.contractNo,
    kind: contract.kind,
    startDate: contract.startDate,
    endDate: contract.endDate,
    payType: contract.payType,
    payRate: contract.payRate,
    employeeName,
    orgName,
  };
}
