import {describe,expect,it,vi} from "vitest";
import {normalizeHubtelSmsTestNumber,submitHubtelSmsTest} from
  "../src/messaging/hubtel-sms-test.js";
const req={clientId:"sms-client-id",secret:"sms-private-secret",
  senderId:"LIGHTWORLD",recipient:"233241234567"};
describe("Hubtel SMS simple POST connection test",()=>{
  it("accepts Ghana number variants and rejects unsupported recipients",()=>{
    expect(normalizeHubtelSmsTestNumber("0241234567")).toBe("233241234567");
    expect(normalizeHubtelSmsTestNumber("+233241234567")).toBe("233241234567");
    expect(()=>normalizeHubtelSmsTestNumber("+441234567890")).toThrow();
    expect(()=>normalizeHubtelSmsTestNumber("invalid-number")).toThrow();
  });
  it("posts exactly one authenticated request to the documented Hubtel SMS endpoint",async()=>{
    const fetchMock=vi.fn(async(url:RequestInfo|URL,opts?:RequestInit)=>{
      expect(url).toBe("https://sms.hubtel.com/v1/messages/send");
      expect(opts?.method).toBe("POST");
      expect((opts?.headers as Record<string,string>).authorization).toBe(
        "Basic "+Buffer.from(req.clientId+":"+req.secret).toString("base64"));
      expect(JSON.parse(String(opts?.body))).toEqual({
        From:req.senderId,To:req.recipient,
        Content:"TradeOS Hubtel SMS connection test. No action is required."});
      return new Response(JSON.stringify({messageId:"123e4567-e89b-42d3-a456-426614174000",
        status:0,statusDescription:"request submitted successfully"}),{
        status:201});
    });
    expect(await submitHubtelSmsTest({...req,fetchImpl:fetchMock as typeof fetch}))
      .toBe("123e4567-e89b-42d3-a456-426614174000");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("fails closed on provider auth rejection, invalid response and network loss",async()=>{
    const bad=new Response(JSON.stringify({error:"denied"}),{status:403});
    await expect(submitHubtelSmsTest({...req,fetchImpl:async()=>bad}))
      .rejects.toMatchObject({code:"HUBTEL_SMS_TEST_NOT_ACCEPTED"});
    await expect(submitHubtelSmsTest({...req,fetchImpl:async()=>new Response(
      JSON.stringify({messageId:"msg123",status:7}),{status:200})}))
      .rejects.toMatchObject({code:"HUBTEL_SMS_TEST_OUTCOME_UNKNOWN"});
    await expect(submitHubtelSmsTest({...req,fetchImpl:async()=>{
      throw new Error("provider timeout");}}))
      .rejects.toMatchObject({code:"HUBTEL_SMS_TEST_OUTCOME_UNKNOWN"});
  });
});
