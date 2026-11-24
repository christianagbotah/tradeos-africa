import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
const root=path.resolve(__dirname,"..");
function files(dir:string):string[]{return readdirSync(dir,{withFileTypes:true}).flatMap(f=>f.isDirectory()?files(path.join(dir,f.name)):[path.join(dir,f.name)]);}
describe("custom platform admin feedback",()=>{
  it("removes browser modal calls from the admin UI",()=>{
    for(const file of files(root).filter(p=>p.endsWith(".tsx"))){
      expect(readFileSync(file,"utf8"),file).not.toMatch(/window\.(confirm|prompt|alert)\(/);
    }
  });
  it("mounts styled focus-safe dialogs and feedback viewport",()=>{
    expect(readFileSync(path.join(root,"layout.tsx"),"utf8")).toContain("<ActionFeedbackViewport />");
    expect(readFileSync(path.join(root,"action-dialog.css"),"utf8")).toContain(".tos-custom-dialog::backdrop");
    expect(readFileSync(path.join(root,"components/action-dialog.ts"),"utf8")).toContain("dialog.showModal()");
  });
  it("invalidates admin resources after confirmed writes and rejects stale responses",()=>{
    const s=readFileSync(path.join(root,"components/platform-admin-session.tsx"),"utf8");
    expect(s).toContain('response.ok && ["POST","PUT","PATCH","DELETE"]');
    expect(s).toContain("generation.current===requestId");
    expect(s).toContain('cache:"no-store"');
  });
});
