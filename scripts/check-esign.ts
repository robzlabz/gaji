/**
 * Cek hash & kedaluwarsa tanda tangan kontrak tanpa database.
 *
 * Jalankan: bun scripts/check-esign.ts  (atau `npm run check:esign`)
 *
 * Yang dibuktikan:
 * 1. Hash ringkasan kontrak deterministik: isi sama → hash sama.
 * 2. Upah/periode/pihak yang berubah → hash berubah (dasar deteksi "kontrak
 *    berubah setelah ditandatangani").
 * 3. Nomor kontrak berisi baris baru tidak bisa memalsukan field lain.
 * 4. Token acak, berbentuk benar, dan tidak berulang.
 * 5. Token kedaluwarsa sesuai batas default 14 hari dan status efektifnya benar
 *    (`sent` → `expired`), sementara `signed`/`revoked` tidak ikut berubah.
 */
import {
  canonicalContractSummary,
  contractChangedSinceSignature,
  createSignToken,
  effectiveSignatureStatus,
  hashContractSummary,
  isSignatureExpired,
  isSignTokenShape,
  normalizePayRate,
  signatureExpiry,
  SIGN_TOKEN_TTL_DAYS,
  type ContractSummary,
} from "../src/lib/esign";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : ` — harap ${JSON.stringify(expected)}, dapat ${JSON.stringify(actual)}`}`);
}

const base: ContractSummary = {
  contractNo: "001/PKWT/I/2026",
  kind: "pkwt",
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  payType: "monthly",
  payRate: "5000000.00",
  employeeName: "Budi Santoso",
  orgName: "CV Maju Jaya",
};

/* 1. determinisme ---------------------------------------------------------- */
const firstHash = hashContractSummary(base);
check("hash berupa hex 64 karakter", /^[0-9a-f]{64}$/.test(firstHash), true);
check("isi sama → hash sama", hashContractSummary({ ...base }), firstHash);
check("urutan objek tidak memengaruhi hash", hashContractSummary({ ...base, payRate: "5000000.00" }), firstHash);

/* 2. normalisasi upah ------------------------------------------------------ */
check("tarif tanpa desimal dinormalkan", normalizePayRate("5000000"), "5000000.00");
check("tarif angka dinormalkan", normalizePayRate(5000000), "5000000.00");
check("tarif kosong dinormalkan", normalizePayRate(null), "0.00");
check("'5000000' dan '5000000.00' → hash sama", hashContractSummary({ ...base, payRate: "5000000" }), firstHash);

/* 3. perubahan isi mengubah hash ------------------------------------------- */
const raised = hashContractSummary({ ...base, payRate: "5500000.00" });
check("upah naik → hash berubah", raised !== firstHash, true);
check("upah turun → hash berubah", hashContractSummary({ ...base, payRate: "4500000.00" }) !== firstHash, true);
check("tanggal mulai berubah → hash berubah", hashContractSummary({ ...base, startDate: "2026-02-01" }) !== firstHash, true);
check("tanggal akhir berubah → hash berubah", hashContractSummary({ ...base, endDate: "2027-06-30" }) !== firstHash, true);
check("tanggal akhir diisi → hash berubah", hashContractSummary({ ...base, endDate: null }) !== firstHash, true);
check("tipe upah berubah → hash berubah", hashContractSummary({ ...base, payType: "daily" }) !== firstHash, true);
check("jenis kontrak berubah → hash berubah", hashContractSummary({ ...base, kind: "pkwtt" }) !== firstHash, true);
check("nomor kontrak berubah → hash berubah", hashContractSummary({ ...base, contractNo: "002/PKWT/I/2026" }) !== firstHash, true);
check("nama karyawan berubah → hash berubah", hashContractSummary({ ...base, employeeName: "Budi Santosa" }) !== firstHash, true);
check("nama perusahaan berubah → hash berubah", hashContractSummary({ ...base, orgName: "PT Maju Jaya" }) !== firstHash, true);

/* 4. teks kanonik tidak bisa disusupi baris baru --------------------------- */
const injected = canonicalContractSummary({ ...base, contractNo: "001\njenis=pkwtt" });
check("baris baru di nomor kontrak dilipat", injected.split("\n").length, 9);
check("field tarif tidak bisa dipalsukan", injected.includes("tarif=5000000.00"), true);
check("nilai disusupi tetap jadi bagian nomor", injected.includes("nomor=001 jenis=pkwtt"), true);

/* 5. token ----------------------------------------------------------------- */
const token = createSignToken();
check("token berbentuk benar", isSignTokenShape(token), true);
const tokens = new Set(Array.from({ length: 200 }, () => createSignToken()));
check("200 token semuanya unik", tokens.size, 200);
check("token acak tidak diulang", createSignToken() !== createSignToken(), true);
check("token kosong ditolak", isSignTokenShape(""), false);
check("tanpa awalan ditolak", isSignTokenShape("abcdefghijklmnopqrstuvwxyz012345"), false);
check("awalan tanpa isi ditolak", isSignTokenShape("sgn_"), false);
check("isi terlalu pendek ditolak", isSignTokenShape("sgn_pendek"), false);
check("karakter di luar base64url ditolak", isSignTokenShape(`${token}!`), false);
check("spasi ditolak", isSignTokenShape(`${token} `), false);
check("bentuk benar walau isinya berulang", isSignTokenShape("sgn_000000000000000000000000"), true);

/* 6. kedaluwarsa ------------------------------------------------------------ */
const now = new Date("2026-11-01T08:00:00.000Z");
const expiry = signatureExpiry(now);
check("TTL default 14 hari", SIGN_TOKEN_TTL_DAYS, 14);
check("tenggat = sekarang + 14 hari", expiry.toISOString(), "2026-11-15T08:00:00.000Z");
check("belum lewat tenggat", isSignatureExpired(expiry, now), false);
check("tepat di tenggat = kedaluwarsa", isSignatureExpired(expiry, new Date(expiry)), true);
check("sesudah tenggat = kedaluwarsa", isSignatureExpired(expiry, new Date(expiry.getTime() + 1)), true);

check(
  "status efektif masih menunggu",
  effectiveSignatureStatus({ status: "sent", expiresAt: expiry }, now),
  "sent",
);
check(
  "status efektif jadi kedaluwarsa",
  effectiveSignatureStatus({ status: "sent", expiresAt: expiry }, new Date("2026-11-16T00:00:00.000Z")),
  "expired",
);
check(
  "sudah ditandatangani tetap signed",
  effectiveSignatureStatus({ status: "signed", expiresAt: expiry }, new Date("2030-01-01T00:00:00.000Z")),
  "signed",
);
check(
  "dicabut tetap revoked",
  effectiveSignatureStatus({ status: "revoked", expiresAt: expiry }, new Date("2030-01-01T00:00:00.000Z")),
  "revoked",
);
check(
  "kolom expired tetap expired",
  effectiveSignatureStatus({ status: "expired", expiresAt: expiry }, now),
  "expired",
);

/* 7. pembanding hash simpan vs sekarang ------------------------------------ */
check("hash tersimpan sama → tidak berubah", contractChangedSinceSignature(firstHash, { ...base }), false);
check("upah berubah → terdeteksi berubah", contractChangedSinceSignature(firstHash, { ...base, payRate: "6000000.00" }), true);
check("tanpa hash tersimpan → tidak diklaim berubah", contractChangedSinceSignature(null, base), false);

console.log(
  failures === 0 ? "\nSemua cek tanda tangan elektronik lolos." : `\n${failures} cek gagal.`,
);
process.exit(failures === 0 ? 0 : 1);
