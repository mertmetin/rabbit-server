// Sends a text message. SMS_PROVIDER=log (the default) prints it to the
// server console so codes can be read during development.
export async function sendSms(phone: string, text: string): Promise<void> {
  const provider = process.env.SMS_PROVIDER ?? "log";
  if (provider === "log") {
    console.log(`[sms] to +1${phone}: ${text}`);
    return;
  }
  throw new Error(`SMS provider "${provider}" is not configured.`);
}
