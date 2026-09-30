import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { ApiError } from "./http";

let sns: SNSClient | null = null;

// True only when texts are printed instead of sent, on a development machine.
// Used to show sign-in codes in the app while testing without an SMS account.
export const smsIsFake = () => (process.env.SMS_PROVIDER ?? "log") === "log" && process.env.NODE_ENV === "development";

// Sends a text message to a 10-digit Canadian/US number.
//   SMS_PROVIDER=log (default): print it to the server console (development).
//   SMS_PROVIDER=sns: Amazon SNS. AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION.
//   SMS_PROVIDER=twilio: Twilio. TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM (+1…).
export async function sendSms(phone: string, text: string): Promise<void> {
  const provider = process.env.SMS_PROVIDER ?? "log";

  if (provider === "log") {
    console.log(`[sms] to +1${phone}: ${text}`);
    return;
  }

  if (provider === "sns") {
    sns ??= new SNSClient({ region: process.env.AWS_REGION ?? "ca-central-1" });
    try {
      await sns.send(
        new PublishCommand({
          PhoneNumber: `+1${phone}`,
          Message: text,
          MessageAttributes: {
            // Transactional = one-time codes: higher delivery priority than marketing.
            "AWS.SNS.SMS.SMSType": { DataType: "String", StringValue: "Transactional" },
          },
        }),
      );
    } catch (err) {
      console.error("[sms] SNS send failed:", err instanceof Error ? err.message : err);
      throw new ApiError(502, "We couldn't send the text message. Please try again.");
    }
    return;
  }

  if (provider === "twilio") {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: { authorization: `Basic ${auth}`, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: `+1${phone}`, From: process.env.TWILIO_FROM ?? "", Body: text }),
    });
    if (!res.ok) {
      console.error("[sms] Twilio send failed:", res.status, await res.text().catch(() => ""));
      throw new ApiError(502, "We couldn't send the text message. Please try again.");
    }
    return;
  }

  throw new Error(`SMS provider "${provider}" is not configured.`);
}
