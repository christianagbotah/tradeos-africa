import { describe,it,expect } from "vitest";
import { saleActionFeedback,signOutFeedback } from "./action-feedback";
describe("native transaction result feedback",()=>{
  it("distinguishes server-confirmed success from pending local capture",()=>{
    expect(saleActionFeedback({tone:"success",message:"Confirmed"},null,false)).toMatchObject({tone:"success",title:"Sale completed"});
    expect(saleActionFeedback({tone:"pending",message:"Awaiting sync"},null,false)).toMatchObject({tone:"warning",title:"Saved on this device",message:"Awaiting sync"});
  });
  it("keeps quick serve fast but displays errors and review outcomes",()=>{
    expect(saleActionFeedback({tone:"success",message:"Confirmed"},null,true)).toBeNull();
    expect(saleActionFeedback({tone:"pending",message:"Awaiting sync"},null,true)).toBeNull();
    expect(saleActionFeedback({tone:"review",message:"Stock changed"},null,true)).toMatchObject({tone:"danger",title:"Sale needs review"});
    expect(saleActionFeedback(null,"Save failed",true)).toMatchObject({tone:"danger"});
  });
  it("requires explicit sign out and explains preserved offline data",()=>{
    expect(signOutFeedback.confirmLabel).toBe("Sign out");
    expect(signOutFeedback.message).toContain("remain on this device");
  });
});
