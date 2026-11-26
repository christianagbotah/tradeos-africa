import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { applySaleMutation } from "../src/commerce/sales.js";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool=createPool(), app=buildApp(pool);
beforeAll(async()=>{await app.ready();});
beforeEach(async()=>{await pool.query("TRUNCATE TABLE app_users,businesses CASCADE");});
afterAll(async()=>{await app.close();await pool.end();});

describe("immutable original sale stock valuation evidence",()=>{
  it("records independently costed ingredients for a real multi-component service sale",async()=>{
    const user=await app.inject({method:"POST",url:"/v1/auth/register",payload:{
      displayName:"Recipe Cost Auditor",email:"recipe-cost-evidence@tradeos.test",
      password:"TradeOS-Recipe-Test-2026!",platform:"WEB",deviceKey:"cost-evidence-device",
      appVersion:"test",
    }});
    expect(user.statusCode,user.body).toBe(201);
    const headers={authorization:`Bearer ${user.json().session.accessToken}`};
    const onboard=await app.inject({method:"POST",url:"/v1/onboarding/business",
      headers,payload:{name:"Audited Recipes",businessType:"SALON_BARBER",branchName:"Main"}});
    expect(onboard.statusCode,onboard.body).toBe(201);
    const {businessId,branchId}={
      businessId:onboard.json().business.id as string,
      branchId:onboard.json().branch.id as string,
    };

    async function item(name:string,kind:"PRODUCT"|"SERVICE",cost:number,stock:number) {
      const id=(await pool.query<{id:string}>(
        "INSERT INTO catalog_items(business_id,name,kind,track_stock,stock_unit_code) " +
        "VALUES($1,$2,$3,$4,$5) RETURNING id",
        [businessId,name,kind,kind==="PRODUCT",kind==="PRODUCT"?"ml":null],
      )).rows[0]!.id;
      await pool.query(
        "INSERT INTO catalog_item_units(business_id,item_id,unit_code,unit_label,"+
        "can_sell,can_stock,default_sale_price_minor) VALUES($1,$2,$3,$4,true,$5,7000)",
        [businessId,id,kind==="SERVICE"?"service":"ml",
          kind==="SERVICE"?"Service":"Millilitre",kind==="PRODUCT"],
      );
      if(kind==="PRODUCT"){
        await pool.query(
          "INSERT INTO inventory_movements(business_id,branch_id,item_id,"+
          "stock_unit_code,quantity_delta,location_type,reason,"+
          "reference_type,reference_id,idempotency_key,occurred_at) "+
          "VALUES($1,$2,$3,'ml',$4,'AVAILABLE','OPENING_BALANCE','CATALOG_ITEM',$3,$5,now())",
          [businessId,branchId,id,stock,"open-"+id],
        );
        await pool.query(
          "INSERT INTO inventory_valuations(business_id,branch_id,item_id,location_type,quantity,value_minor) "+
          "VALUES($1,$2,$3,'AVAILABLE',$4,$5)",
          [businessId,branchId,id,stock,cost],
        );
      }
      return id;
    }
    const shampoo=await item("Shampoo","PRODUCT",4000,200);
    const conditioner=await item("Conditioner","PRODUCT",5000,100);
    const treatment=await item("Treatment service","SERVICE",0,0);
    const definition=(await pool.query<{id:string}>(
      "INSERT INTO consumption_definitions(business_id,output_item_id,output_quantity,output_unit_code) "+
      "VALUES($1,$2,1,'service') RETURNING id",
      [businessId,treatment],
    )).rows[0]!.id;
    for(const [component,qty] of [[shampoo,50],[conditioner,25]] as const){
      await pool.query(
        "INSERT INTO consumption_components(definition_id,component_item_id,stock_unit_code,"+
        "quantity_per_output,expected_waste_percent) VALUES($1,$2,'ml',$3,0)",
        [definition,component,qty],
      );
    }
    const clientMutationId=randomUUID();
    const context={businessId,branchId,clientMutationId,occurredAt:new Date().toISOString()};
    const payload={paymentMethod:"CASH" as const,
      lines:[{itemId:treatment,saleUnitCode:"service",quantity:1}]};
    const sold=await applySaleMutation(pool,context,payload);
    expect(sold).toMatchObject({status:"COMPLETED",idempotentReplay:false,totalMinor:7000});
    const row=(await pool.query<{line_cost_minor:string}>(
      "SELECT line_cost_minor::text FROM sale_lines WHERE sale_id=$1",
      [sold.saleId],
    )).rows[0]!;
    expect(Number(row.line_cost_minor)).toBe(2250);

    const costed=(await pool.query<{
      item_id:string;consumed_quantity:string;consumed_cost_minor:string;
      quantity_delta:string;reason:string;stock_unit_code:string;
    }>(
      "SELECT sc.item_id,sc.consumed_quantity::text,sc.consumed_cost_minor::text,"+
      "m.quantity_delta::text,m.reason,m.stock_unit_code "+
      "FROM sale_stock_cost_allocations sc "+
      "JOIN inventory_movements m ON m.id=sc.inventory_movement_id "+
      "JOIN sale_lines sl ON sl.id=sc.sale_line_id "+
      "WHERE sl.sale_id=$1 AND sc.business_id=$2 ORDER BY sc.item_id",
      [sold.saleId,businessId],
    )).rows;
    expect(costed).toHaveLength(2);
    const mapped=new Map(costed.map(row=>[row.item_id,row]));
    expect(mapped.get(shampoo)).toMatchObject({
      consumed_quantity:"50.00000000",consumed_cost_minor:"1000",
      quantity_delta:"-50.00000000",reason:"SERVICE_CONSUMPTION",stock_unit_code:"ml",
    });
    expect(mapped.get(conditioner)).toMatchObject({
      consumed_quantity:"25.00000000",consumed_cost_minor:"1250",
      quantity_delta:"-25.00000000",reason:"SERVICE_CONSUMPTION",stock_unit_code:"ml",
    });
    const replay=await applySaleMutation(pool,context,payload);
    expect(replay).toMatchObject({status:"COMPLETED",idempotentReplay:true});
    expect((await pool.query<{count:string}>(
      "SELECT COUNT(*)::text AS count FROM sale_stock_cost_allocations WHERE business_id=$1",
      [businessId])).rows[0]!.count).toBe("2");
    await expect(pool.query(
      "UPDATE sale_stock_cost_allocations SET consumed_cost_minor=0 WHERE business_id=$1",
      [businessId],
    )).rejects.toThrow();
    await expect(pool.query(
      "DELETE FROM sale_stock_cost_allocations WHERE business_id=$1",[businessId],
    )).rejects.toThrow();
  });
});
