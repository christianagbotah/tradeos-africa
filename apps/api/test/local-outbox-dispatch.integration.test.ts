import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPool } from "../src/db.js";
import { dispatchOneLocalOutboxEvent, type LocalOutboxConsumer } from "../src/outbox/local-dispatch.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool=createPool();
const business=randomUUID(),other=randomUUID();
const eventId=randomUUID(),foreignId=randomUUID(),unknownId=randomUUID();
const consumer:LocalOutboxConsumer={
  async deliverAndVerify(client,event){
    // Synthetic durable destination, never a real payment or external service.
    await client.query("INSERT INTO qa_local_outbox_destination(event_id,business_id) VALUES($1,$2)",[event.id,event.business_id]);
    const verified=await client.query("SELECT 1 FROM qa_local_outbox_destination WHERE event_id=$1 AND business_id=$2",[event.id,event.business_id]);
    return verified.rowCount===1;
  }
};
const registry=new Map([["QA_LOCAL_DELIVERY",consumer]]);

beforeEach(async()=>{
  await pool.query("TRUNCATE TABLE businesses CASCADE");
  await pool.query("CREATE TABLE IF NOT EXISTS qa_local_outbox_destination(event_id uuid PRIMARY KEY,business_id uuid NOT NULL)");
  await pool.query("TRUNCATE TABLE qa_local_outbox_destination");
  await pool.query("INSERT INTO businesses(id,name,business_type) VALUES($1,'Synthetic A','DRINKING_SPOT'),($2,'Synthetic B','DRINKING_SPOT')",[business,other]);
  for(const [id,owner,type] of [[eventId,business,"QA_LOCAL_DELIVERY"],[foreignId,other,"QA_LOCAL_DELIVERY"],[unknownId,business,"QA_UNREGISTERED"]]){
    await pool.query("INSERT INTO outbox_events(id,business_id,aggregate_type,aggregate_id,event_type,payload) VALUES($1,$2,'QA',$1,$3,'{}')",[id,owner,type]);
  }
});
afterAll(async()=>{try{await pool.query("DROP TABLE IF EXISTS qa_local_outbox_destination");}finally{await pool.end();}});
const counts=async()=>(await pool.query("SELECT (SELECT count(*)::int FROM outbox_events WHERE published_at IS NOT NULL) AS published,(SELECT count(*)::int FROM qa_local_outbox_destination) AS delivered")).rows[0];

describe("transactional local outbox consumer boundary",()=>{
  it("leaves unregistered and foreign events pending, and does not redeliver a published event",async()=>{
    expect(await dispatchOneLocalOutboxEvent(pool,business,new Map())).toBe("EMPTY");
    expect(await counts()).toEqual({published:0,delivered:0});
    expect(await dispatchOneLocalOutboxEvent(pool,business,registry)).toBe("DELIVERED");
    expect(await dispatchOneLocalOutboxEvent(pool,business,registry)).toBe("EMPTY");
    expect(await counts()).toEqual({published:1,delivered:1});
    const pending=(await pool.query<{id:string}>("SELECT id FROM outbox_events WHERE published_at IS NULL ORDER BY id")).rows.map(r=>r.id);
    expect(pending).toEqual([foreignId,unknownId].sort());
  });
  it("rolls back actual destination writes when delivery is not verified or the consumer throws",async()=>{
    for(const fail of ["false","throw"]){
      const bad:LocalOutboxConsumer={async deliverAndVerify(client,event){
        await consumer.deliverAndVerify(client,event);
        if(fail==="throw")throw new Error("Synthetic consumer crash");
        return false;
      }};
      await expect(dispatchOneLocalOutboxEvent(pool,business,new Map([["QA_LOCAL_DELIVERY",bad]]))).rejects.toThrow();
      expect(await counts()).toEqual({published:0,delivered:0});
    }
    expect(await dispatchOneLocalOutboxEvent(pool,business,registry)).toBe("DELIVERED");
    expect(await counts()).toEqual({published:1,delivered:1});
  });
  it("serializes concurrent consumers without duplicate durable writes",async()=>{
    const result=await Promise.all([
      dispatchOneLocalOutboxEvent(pool,business,registry),
      dispatchOneLocalOutboxEvent(pool,business,registry),
    ]);
    expect(result.sort()).toEqual(["DELIVERED","EMPTY"]);
    expect(await counts()).toEqual({published:1,delivered:1});
  });
});
