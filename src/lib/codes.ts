import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { CodePurpose, User } from "@/generated/prisma/client";
import { db } from "./db";
import { ApiError, badRequest } from "./http";
import { sendSms } from "./sms";

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_GAP_MS = 30 * 1000;
const MAX_CODES_PER_HOUR = 5;

const hashCode = (code: string) =>
  createHmac("sha256", process.env.JWT_SECRET!).update(code).digest("hex");

const MESSAGES: Record<CodePurpose, string> = {
  login: "Your Rabbit code is",
  activation: "Your Rabbit activation code is",
  password_reset: "Your Rabbit password reset code is",
};

// Sign-in codes are the only thing protecting an account, so they're 6 digits.
const DIGITS: Record<CodePurpose, number> = { login: 6, activation: 4, password_reset: 4 };

// Texts a fresh code and retires any earlier unused code for the same purpose.
export async function issueCode(user: User, purpose: CodePurpose) {
  const now = Date.now();
  const recent = await db.verificationCode.findMany({
    where: { userId: user.id, purpose, createdAt: { gt: new Date(now - 60 * 60 * 1000) } },
    orderBy: { createdAt: "desc" },
  });
  if (recent[0] && now - recent[0].createdAt.getTime() < RESEND_GAP_MS) {
    throw new ApiError(429, "Please wait a moment before requesting another code.");
  }
  if (recent.length >= MAX_CODES_PER_HOUR) {
    throw new ApiError(429, "Too many codes requested. Try again in an hour.");
  }

  const digits = DIGITS[purpose];
  const code = String(randomInt(0, 10 ** digits)).padStart(digits, "0");
  await db.$transaction([
    db.verificationCode.updateMany({
      where: { userId: user.id, purpose, usedAt: null },
      data: { expiresAt: new Date(now) },
    }),
    db.verificationCode.create({
      data: { userId: user.id, purpose, codeHash: hashCode(code), expiresAt: new Date(now + CODE_TTL_MS) },
    }),
  ]);
  // Ends with the code so iOS can offer it above the keyboard.
  await sendSms(user.phone, `${MESSAGES[purpose]} ${code}. It expires in 10 minutes.`);
}

// Marks the code used if it matches; otherwise counts a failed attempt.
export async function consumeCode(userId: number, purpose: CodePurpose, code: string) {
  const record = await db.verificationCode.findFirst({
    where: { userId, purpose, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!record || record.attempts >= MAX_ATTEMPTS) {
    throw badRequest("This code has expired. Request a new one.");
  }

  const expected = Buffer.from(record.codeHash, "hex");
  const actual = Buffer.from(hashCode(code.trim()), "hex");
  if (!timingSafeEqual(expected, actual)) {
    await db.verificationCode.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });
    throw badRequest("Wrong code entered.");
  }

  // Conditional update so two simultaneous requests can't both use the code.
  const { count } = await db.verificationCode.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (count === 0) throw badRequest("This code has expired. Request a new one.");
}
