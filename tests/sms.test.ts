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

afterEach(() => {
  sent.length = 0;
  fail = false;
  delete process.env.SMS_PROVIDER;
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
});
