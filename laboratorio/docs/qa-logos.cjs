const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{let b;try{
 const manifest=JSON.parse(fs.readFileSync('static/logo-manifest.json','utf8')).logos;
 assert.equal(Object.keys(manifest).length,27);
 b=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const p=await b.newPage({viewport:{width:1300,height:1150}});
 await p.goto('http://127.0.0.1:8877/');
 const results=await p.evaluate(async manifest=>{
  const {loadBrandLogos,drawBrandLogo,getBrand}=await import('/brand-logos.js');await loadBrandLogos();
  const data=await(await fetch('/api/navigation')).json();
  document.body.replaceChildren();const cv=document.createElement('canvas');cv.width=1300;cv.height=1100;document.body.append(cv);const ctx=cv.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1300,1100);
  const out=[];let i=0;
  for(const[name,entry]of Object.entries(manifest)){
   const x=(i%5)*260,y=Math.floor(i/5)*180;ctx.fillStyle='#192c22';ctx.font='18px sans-serif';ctx.fillText(name,x+12,y+162,240);
   const response=await fetch(entry.path);const image=new Image();image.src=entry.path;let decoded=false;try{await image.decode();decoded=image.naturalWidth>0}catch{}
   out.push({name,path:entry.path,status:response.status,decoded,rendered:drawBrandLogo(ctx,name,x+15,y+12,230,130),matchedStore:data.stores.some(s=>s.name===name),matchedModule:!!getBrand(name)});i++;
  }
  return out;
 },manifest);
 await p.locator('canvas').screenshot({path:'docs/logos-contact.png'});
 fs.writeFileSync('docs/QA_LOGOS.json',JSON.stringify(results,null,2));
 for(const r of results){assert.equal(r.status,200,r.name+' HTTP');assert(r.decoded,r.name+' decode');assert(r.rendered,r.name+' renderer');assert(r.matchedStore,r.name+' dataset');assert(r.matchedModule,r.name+' module');}
 console.log('PASS 27 logos: HTTP, decode, drawBrandLogo, dataset and module association');
}finally{await b?.close()}})().catch(e=>{console.error(e);process.exitCode=1});
