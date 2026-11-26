import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe,expect,it} from "vitest";
import {hubtelPrivateImportFields} from
  "../src/scripts/import-hubtel-private-merchant.js";
const demo=["HUBTEL_SALES_API_ID=demoId",
  "HUBTEL_SALES_API_KEY=demoKeyPlaceholder123",
  "HUBTEL_COLLECTION_ACCOUNT_NUMBER=1234567",
  "HUBTEL_SMS_CLIENT_ID=demoSmsId",
  "HUBTEL_SMS_CLIENT_SECRET=demoSmsSecret987",
  "HUBTEL_SMS_SENDER_ID=LIGHTWORLD"].join("\n");
describe("privileged owner-scoped Hubtel credential import validation",()=>{
  it("accepts the two separate merchant auth domains from a private file",()=>{
    const dir=mkdtempSync(join(tmpdir(),"tradeos-hubtel-demo-"));
    try{
      const file=join(dir,"demo.env");writeFileSync(file,demo);
      expect(hubtelPrivateImportFields(file)).toMatchObject({
        fields:{apiId:"demoId",collectionAccount:"1234567"},
        smsClientId:"demoSmsId",smsSenderId:"LIGHTWORLD"});
      writeFileSync(file,demo.replace("HUBTEL_SMS_CLIENT_SECRET=demoSmsSecret987",""));
      expect(()=>hubtelPrivateImportFields(file)).toThrow(/incomplete/);
    }finally{rmSync(dir,{recursive:true,force:true});}
  });
});
