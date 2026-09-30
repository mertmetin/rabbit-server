import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { ApiError } from "./http";

let sns: SNSClient | null = null;

// Sends a text message to a 10-digit Canadian/US number.
//   SMS_PROVIDER=log (default): print it to the server console (development).
//   SMS_PROVIDER=sns: send through Amazon SNS. Credentials come from
//   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY; region from AWS_REGION.
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

  throw new Error(`SMS provider "${provider}" is not configured.`);
}
