import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { phoneNumber } from "better-auth/plugins";
import { db } from "@/db";
import { account, session, user, verification } from "@/db/schema";

export const auth = betterAuth({
  // Di dev port bisa berubah (3000 bisa dipakai proses lain); biarkan Better Auth
  // menyimpulkan origin dari request selama masih localhost.
  baseURL: process.env.BETTER_AUTH_URL?.includes("localhost")
    ? undefined
    : process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification },
  }),
  advanced: {
    database: {
      // Semua id di skema ini uuid.
      generateId: () => crypto.randomUUID(),
    },
  },
  emailAndPassword: {
    enabled: true,
    // PIN 6 digit
    minPasswordLength: 6,
    maxPasswordLength: 128,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 30,
    customRules: {
      "/sign-in/phone-number": { window: 60, max: 10 },
    },
  },
  plugins: [
    phoneNumber({
      // Login produksi memakai phone + PIN (credential), OTP tidak dipakai.
      sendOTP: async () => {
        throw new Error("OTP tidak diaktifkan pada aplikasi ini.");
      },
      phoneNumberValidator: (value) => /^\d{8,15}$/.test(value),
    }),
  ],
});

export type Auth = typeof auth;
