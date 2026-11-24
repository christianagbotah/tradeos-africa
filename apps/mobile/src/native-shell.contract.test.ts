import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const read=(path:string)=>readFileSync(resolve(__dirname,path),"utf8");
const app=read("../App.tsx"),nav=read("components/BottomNav.tsx"),dialog=read("components/ActionDialog.tsx"),header=read("components/WorkspaceHeader.tsx");
describe("native merchant shell safe areas and web parity",()=>{
  it("uses native insets at the root and gives the bottom edge exclusively to the navigation bar when authenticated",()=>{
    expect(app).toContain('from "react-native-safe-area-context"');
    expect(app).toContain('SafeAreaProvider initialMetrics={initialWindowMetrics}');
    expect(app).toContain('edges={workspaceReady?["top","left","right"]:["top","left","right","bottom"]}');
    expect(nav).toContain('edges={["bottom"]}');
    expect(app).toContain('barStyle={workspaceReady?"dark-content":"light-content"}');
  });
  it("keeps a single persistent white context header outside all screen scroll views",()=>{
    expect(app.match(/<WorkspaceHeader\b/g)).toHaveLength(1);
    expect(header).toContain("backgroundColor:colors.surface");
    expect(header).toContain("{businessName}");
    expect(header).toContain("{branchName}");
    for(const name of ["DashboardScreen","PosScreen","SalesScreen","MoreScreen","NotificationsScreen","BusinessQuestionsScreen"]){
      expect(read("screens/"+name+".tsx")).not.toContain("<WorkspaceHeader");
    }
  });
  it("keeps modal controls inside all four safe edges",()=>{
    expect(dialog).toContain("<SafeAreaProvider>");
    expect(dialog).toContain('edges={["top","bottom","left","right"]}');
    expect(dialog).toContain("navigationBarTranslucent");
  });
  it("matches the web attendant-only navigation boundary",()=>{
    expect(app).toContain('const activeScreen=attendantOnly?"sell":screen');
    expect(nav).toContain('attendantOnly?TABS.filter(tab=>tab.key==="sell")');
    expect(nav).toContain('accessibilityLabel="Sign out of POS"');
    expect(nav).toContain("tabActive:{borderTopColor:colors.gold}");
  });
  it("locks the palette to the canonical merchant web tokens",()=>{
    const tokens=read("../../web/app/tradeos-tokens.css");
    const theme=read("theme.ts");
    for(const [name,css] of [["canvas","canvas"],["surface","surface"],["textStrong","text-strong"],["midnight","midnight"],["gold","gold"],["border","border"]]){
      const value=tokens.match(new RegExp("--tos-"+css+": (#[0-9a-f]{6});"))?.[1];
      expect(value).toBeTruthy();
      expect(theme).toContain(name+': "'+value+'"');
    }
  });
});
