import { afterEach, describe, expect, it, vi } from "vitest";

// The shared test setup replaces sendSms; these tests use the real module.
vi.unmock("@/lib/sms");

const sent: unknown[] = [];
let fail = false;
vi.mock("@aws-sdk/client-sns", () => ({
  SNSClient: class {
    async send(command: { input: unknown }) {
      if (fail) throw new Error("Invalid parameter: PhoneNumber");
      sent.push(command.input);
      return { MessageId: "m-1" };
    }
  },
  PublishCommand: class {
    constructor(public input: unknown) {}
  },
}));

const realFetch = globalThis.fetch;
afterEach(() => {
  sent.length = 0;
  fail = false;
  delete process.env.SMS_PROVIDER;
  globalThis.fetch = realFetch;
  vi.unstubAllEnvs();
});

describe("sending SMS", () => {
  it("sends through Amazon SNS as a transactional text", async () => {
    process.env.SMS_PROVIDER = "sns";
    const { sendSms } = await import("@/lib/sms");
    await sendSms("6135550101", "Your Rabbit code is 123456.");
    expect(sent).toEqual([{
      PhoneNumber: "+16135550101",
      Message: "Your Rabbit code is 123456.",
      MessageAttributes: { "AWS.SNS.SMS.SMSType": { DataType: "String", StringValue: "Transactional" } },
    }]);
  });

  it("tells the customer when the text couldn't be sent", async () => {
    process.env.SMS_PROVIDER = "sns";
    fail = true;
    const { sendSms } = await import("@/lib/sms");
    await expect(sendSms("6135550101", "hi")).rejects.toThrow(/couldn't send the text/);
  });

  it("only logs in development by default", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { sendSms } = await import("@/lib/sms");
    await sendSms("6135550101", "Your Rabbit code is 123456.");
    expect(sent).toEqual([]);
    expect(log).toHaveBeenCalledWith("[sms] to +16135550101: Your Rabbit code is 123456.");
    log.mockRestore();
  });

  it("sends through Twilio", async () => {
    process.env.SMS_PROVIDER = "twilio";
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC123");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "secret");
    vi.stubEnv("TWILIO_FROM", "+16135550000");
    const calls: { url: string; body: string; auth: string }[] = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body), auth: (init.headers as Record<string, string>).authorization });
      return new Response("{}", { status: 201 });
    }) as typeof fetch;

    const { sendSms } = await import("@/lib/sms");
    await sendSms("6135550101", "Your Rabbit code is 123456.");
    expect(calls[0].url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json");
    expect(Object.fromEntries(new URLSearchParams(calls[0].body))).toEqual({
      To: "+16135550101", From: "+16135550000", Body: "Your Rabbit code is 123456.",
    });
    expect(calls[0].auth).toBe(`Basic ${Buffer.from("AC123:secret").toString("base64")}`);
  });

  it("shows codes in the app only when texts are fake on a development machine", async () => {
    const { smsIsFake } = await import("@/lib/sms");
    vi.stubEnv("NODE_ENV", "development");
    expect(smsIsFake()).toBe(true);
    process.env.SMS_PROVIDER = "sns";
    expect(smsIsFake()).toBe(false);
    delete process.env.SMS_PROVIDER;
    vi.stubEnv("NODE_ENV", "production");
    expect(smsIsFake()).toBe(false);
  });
});
