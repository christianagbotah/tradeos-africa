import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,beforeEach,describe,expect,it} from "vitest";
import {buildApp} from "../src/app.js";
import {createPool} from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool=createPool(),app=buildApp(pool);
beforeAll(async()=>{await app.ready();});
beforeEach(async()=>{await pool.query("TRUNCATE TABLE app_users, businesses CASCADE");});
afterAll(async()=>{await app.close();await pool.end();});
const auth=(token:string)=>({authorization:"Bearer "+token});
async function register(email:string,deviceKey:string){
  const response=await app.inject({method:"POST",url:"/v1/auth/register",
    payload:{displayName:"TradeOS staff",email,password:"TradeOS-12345",
      platform:"WEB",deviceKey,appVersion:"test"}});
  expect(response.statusCode,response.body).toBe(201);
  return response.json() as {user:{id:string};session:{accessToken:string}};
}
const date="2026-11-24";
async function fixture(){
  const owner=await register("owner-cashshift@tradeos.test","own-shift-owner");
  const attendant=await register("cashshift-attendant@tradeos.test","own-shift-attendant");
  const onboard=await app.inject({method:"POST",url:"/v1/onboarding/business",
    headers:auth(owner.session.accessToken),
    payload:{name:"Mama Akosua Waakye",businessType:"SERVICES",branchName:"Main",
      countryCode:"GH",currencyCode:"GHS",timezone:"Africa/Accra"}});
  expect(onboard.statusCode,onboard.body).toBe(201);
  const businessId=onboard.json().business.id as string;
  const branchId=onboard.json().branch.id as string;
  const staffId=randomUUID();
  await pool.query(
    "INSERT INTO staff(id,business_id,display_name,email,role) VALUES($1,$2,$3,$4,'POS_ATTENDANT')",
    [staffId,businessId,"Attendant","cashshift-attendant@tradeos.test"],
  );
  await pool.query(
    "INSERT INTO business_memberships(business_id,user_id,staff_id,role,status) VALUES($1,$2,$3,'POS_ATTENDANT','ACTIVE')",
    [businessId,attendant.user.id,staffId],
  );
  await pool.query(
    "INSERT INTO pos_attendant_branch_assignments(business_id,staff_id,branch_id,assigned_by_staff_id) VALUES($1,$2,$3,(SELECT staff_id FROM business_memberships WHERE business_id=$1 AND role='OWNER' LIMIT 1))",
    [businessId,staffId,branchId],
  );
  const product=await app.inject({method:"POST",url:"/v1/catalog/items",
    headers:auth(owner.session.accessToken),
    payload:{businessId,name:"Waakye",kind:"PREPARED_PRODUCT",units:[
      {code:"portion",label:"Food portion",canSell:true,defaultSalePriceMinor:1500},
    ]}});
  expect(product.statusCode,product.body).toBe(201);
  const itemId=product.json().item.id as string;
  const call=(role:"owner"|"attendant",mutationType:string,payload:unknown,
    occurredAt="2026-11-24T09:00:00Z",key=randomUUID(),branch=branchId)=>{
    return app.inject({method:"POST",url:"/v1/sync",headers:auth(
      role==="owner"?owner.session.accessToken:attendant.session.accessToken,
    ),payload:{mutations:[{
      businessId,branchId:branch,
      clientId:role==="owner"?"own-shift-owner":"own-shift-attendant",
      clientMutationId:key,mutationType,occurredAt,payload,
    }]}});
  };
  const get=(role:"owner"|"attendant",resource:"current"|"days"|"shifts",branch=branchId)=>
    app.inject({method:"GET",url:"/v1/operations/"+resource+"?businessId="+businessId+
      "&branchId="+branch,
      headers:auth(role==="owner"?owner.session.accessToken:attendant.session.accessToken)});
  return {owner,attendant,businessId,branchId,staffId,itemId,call,get};
}
const closing=(shiftId:string,cash=3900)=>({shiftId,closingBalances:[
  {method:"CASH",countedMinor:cash},
  {method:"MOMO",countedMinor:0},
  {method:"CARD",countedMinor:0},
  {method:"BANK",countedMinor:0},
  {method:"OTHER",countedMinor:0},
]});
describe("POS-only staff own cash shift: real ledger and role authorization",()=>{
  it("owner opens business day; attendant opens own shift, sells, counts variance and closes",async()=>{
    const f=await fixture();
    const noDay=await f.get("attendant","current");
    expect(noDay.statusCode,noDay.body).toBe(200);
    expect(noDay.json()).toEqual({operatingDay:null,shift:null,openShiftCount:0});

    const dayResponse=await f.call("owner","OPERATING_DAY_OPEN_CREATE",{
      businessDate:date,openingBalances:[{method:"CASH",countedMinor:5000}],
    });
    expect(dayResponse.statusCode,dayResponse.body).toBe(200);
    expect(dayResponse.json().mutationResults[0].status).toBe("APPLIED");
    const dayId=dayResponse.json().mutationResults[0].result.id as string;

    const context=await f.get("attendant","current");
    expect(context.statusCode,context.body).toBe(200);
    expect(context.json().operatingDay).toMatchObject({id:dayId,status:"OPEN"});
    expect(context.json().operatingDay).not.toHaveProperty("balances");
    expect(context.json()).not.toHaveProperty("businessDate");
    expect(context.json()).not.toHaveProperty("branchTotals");

    const key=randomUUID();
    const openPayload={dayId,openingBalances:[{method:"CASH",countedMinor:1000}],note:"Starting change"};
    const opened=await f.call("attendant","SHIFT_OPEN_CREATE",openPayload,
      "2026-11-24T09:10:00Z",key);
    expect(opened.statusCode,opened.body).toBe(200);
    expect(opened.json().mutationResults[0].status).toBe("APPLIED");
    const shiftId=opened.json().mutationResults[0].result.id as string;
    const repeated=await f.call("attendant","SHIFT_OPEN_CREATE",openPayload,
      "2026-11-24T09:10:00Z",key);
    expect(repeated.json().mutationResults[0].result.id).toBe(shiftId);

    const sale=await f.call("attendant","SALE_CREATE",{
      paymentMethod:"CASH",currencyCode:"GHS",
      lines:[{itemId:f.itemId,saleUnitCode:"portion",quantity:2}],
    },"2026-11-24T09:20:00Z");
    expect(sale.statusCode,sale.body).toBe(200);
    expect(sale.json().mutationResults[0].status).toBe("APPLIED");
    const inProgress=await f.get("attendant","current");
    expect(inProgress.statusCode,inProgress.body).toBe(200);
    expect(inProgress.json().shift).toMatchObject({id:shiftId,status:"OPEN"});
    expect(inProgress.json().shift.balances).toHaveLength(1);
    expect(inProgress.json().shift.balances[0]).toMatchObject({
      method:"CASH",openingCountedMinor:1000,expectedClosingMinor:4000,
      movementMinor:3000,
    });
    expect(inProgress.json().operatingDay).not.toHaveProperty("balances");

    const closed=await f.call("attendant","SHIFT_CLOSE_CREATE",closing(shiftId,3900),
      "2026-11-24T17:00:00Z");
    expect(closed.statusCode,closed.body).toBe(200);
    expect(closed.json().mutationResults[0].status).toBe("APPLIED");
    const after=await f.get("attendant","current");
    expect(after.json().shift).toBeNull();
    const history=await f.get("attendant","shifts");
    expect(history.statusCode,history.body).toBe(200);
    expect(history.json().shifts).toHaveLength(1);
    expect(history.json().shifts[0].balances).toHaveLength(1);
    expect(history.json().shifts[0].balances[0]).toMatchObject({
      closingCountedMinor:3900,expectedClosingMinor:4000,varianceMinor:-100,
    });
    expect(history.json().shifts[0]).not.toHaveProperty("staffId");
    expect((await f.get("attendant","days")).statusCode).toBe(403);
    const ownerCurrent=await f.get("owner","current");
    expect(ownerCurrent.json().operatingDay.balances).toHaveLength(5);
    const recorded=await pool.query(
      "SELECT COUNT(*)::int AS n FROM audit_events WHERE business_id=$1 AND event_type IN ('SHIFT_OPENED','SHIFT_CLOSED')",
      [f.businessId]);
    expect(Number(recorded.rows[0]?.n)).toBe(2);
    const postings=await pool.query(
      "SELECT COUNT(*)::int AS n FROM cashbook_entries WHERE business_id=$1 AND entry_type='ADJUSTMENT'",
      [f.businessId]);
    expect(Number(postings.rows[0]?.n)).toBe(0);
  });

  it("denies forged actor, noncash tender, day closing and another shift's close",async()=>{
    const f=await fixture();
    const day=await f.call("owner","OPERATING_DAY_OPEN_CREATE",{
      businessDate:date,openingBalances:[{method:"CASH",countedMinor:0}],
    });
    const dayId=day.json().mutationResults[0].result.id as string;
    const base={dayId,openingBalances:[{method:"CASH",countedMinor:1000}]};
    for(const payload of [
      {...base,actorStaffId:randomUUID()},
      {...base,staffId:randomUUID()},
      {...base,openingBalances:[{method:"CASH",countedMinor:1000},{method:"MOMO",countedMinor:50}]},
      {...base,openingBalances:[{method:"CASH",countedMinor:-1}]},
    ]){
      const response=await f.call("attendant","SHIFT_OPEN_CREATE",payload);
      expect(response.statusCode,response.body).toBe(403);
      expect(response.json().error).toBe("POS_ATTENDANT_SCOPE_FORBIDDEN");
    }
    const dayClose=await f.call("attendant","OPERATING_DAY_CLOSE_CREATE",{
      dayId,closingBalances:closing(randomUUID()).closingBalances,
    });
    expect(dayClose.statusCode).toBe(403);
    const open=await f.call("attendant","SHIFT_OPEN_CREATE",base,
      "2026-11-24T09:10:00Z");
    expect(open.json().mutationResults[0].status).toBe("APPLIED");
    const shiftId=open.json().mutationResults[0].result.id as string;
    const invalidNonCash=await f.call("attendant","SHIFT_CLOSE_CREATE",{
      ...closing(shiftId),closingBalances:[
        {method:"CASH",countedMinor:1000},
        {method:"MOMO",countedMinor:15},
        {method:"CARD",countedMinor:0},
        {method:"BANK",countedMinor:0},
        {method:"OTHER",countedMinor:0},
      ],
    });
    expect(invalidNonCash.statusCode).toBe(403);
    const forged=await f.call("attendant","SHIFT_CLOSE_CREATE",{
      ...closing(shiftId),actorStaffId:randomUUID(),
    });
    expect(forged.statusCode).toBe(403);
    const wrongShift=await f.call("attendant","SHIFT_CLOSE_CREATE",closing(randomUUID()),
      "2026-11-24T17:00:00Z");
    expect(wrongShift.statusCode,wrongShift.body).toBe(200);
    expect(wrongShift.json().mutationResults[0].status).toBe("REJECTED");
    const stillOpen=await f.get("attendant","current");
    expect(stillOpen.json().shift.id).toBe(shiftId);
  });
});
