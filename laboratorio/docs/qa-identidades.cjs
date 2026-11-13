// Visual evidence for per-store identities. Run from workspace root, demo on 8877.
// Distinct screenshot hashes are evidence artifacts, not proof of correct brand identity.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const base=process.env.QA_BASE||'http://127.0.0.1:8877';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const stores=[['Renner','renner','g-south-entrance'],['Cinemark','cinemark','g-south-entrance'],['Outback','outback','g-south-entrance'],['Ri Happy','ri-happy','g-south-entrance'],['Subway','subway','u-west-entry']];
(async()=>{
  let browser;
  try{
    browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-unsafe-swiftshader']});
    const page=await browser.newPage({viewport:{width:1440,height:1100},reducedMotion:'reduce'});
    const errors=[],checks=[],captures=[];page.on('pageerror',e=>errors.push(e.message));
    const pass=s=>{checks.push(s);console.log('PASS',s)};
    const sourceHash=hash(fs.readFileSync('static/navigation-data.json'));
    await page.goto(base+'/explorar.html');await page.waitForFunction(()=>document.querySelector('#map-state').textContent.includes('3D'));
    assert.equal(await page.locator('#reduce-motion').getAttribute('aria-pressed'),'true');
    for(const[name,slug,origin]of stores){
      await page.locator('#reset').click();await page.locator('#origin').selectOption(origin);
      await page.locator('#search').fill(name);await page.locator('#store-list button').filter({hasText:name}).first().click();
      assert.match(await page.locator('#destination h2').innerText(),new RegExp(name));
      await page.mouse.move(1,1);await page.waitForTimeout(400);
      const file=`docs/identity-${slug}.png`;
      const pixels=await page.locator('#scene3d').screenshot({path:file});
      await page.locator('#route-button').click();await page.locator('#route-result li').first().waitFor();
      assert(await page.locator('#route-result li').count()>1);
      assert.match(await page.locator('#route-result').innerText(),/estimativa da planta/);
      const routeFile=`docs/identity-${slug}-route.png`;
      await page.waitForTimeout(200);await page.locator('#scene3d').screenshot({path:routeFile});
      captures.push({store:name,file,sha256:hash(pixels),routeFile});pass(`${name}: selection, focus capture and route`);
    }
    assert.equal(hash(fs.readFileSync('static/navigation-data.json')),sourceHash);pass('Spatial source unchanged during QA');
    assert.deepEqual(errors,[]);pass('No JavaScript exceptions');
    fs.writeFileSync('docs/QA_IDENTIDADES.json',JSON.stringify({checks,errors,sourceHash,captures,visualReview:'Screenshots require human/agent visual inspection; hashes alone do not validate identities.'},null,2));
  }finally{await browser?.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
