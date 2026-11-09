import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Locator, type Page } from 'playwright';
import { BrowserTestPlan, CaseResult, type BrowserTestPlanDto } from '@atoms/contracts/delivery';
import { safeFile } from './files.js';
import { mediaType, browserEnvironment } from './verify.js';

type Result = ReturnType<typeof CaseResult.parse>;
type Selector = BrowserTestPlanDto['cases'][number]['steps'][number] extends never ? never : Parameters<typeof locator>[1];
type Loc = { by: 'role'; role: 'button' | 'textbox' | 'checkbox' | 'heading' | 'article' | 'link' | 'listitem' | 'option'; name: string; exact: boolean; nth?: number }
  | { by: 'label'; name: string; exact: boolean; nth?: number } | { by: 'test_id'; value: string; nth?: number };
function locator(page: Page, spec: Loc): Locator {
  let selected = spec.by === 'role' ? page.getByRole(spec.role, { name: spec.name, exact: spec.exact })
    : spec.by === 'label' ? page.getByLabel(spec.name, { exact: spec.exact }) : page.getByTestId(spec.value);
  if (spec.nth !== undefined) selected = selected.nth(spec.nth);
  return selected;
}
const clip=(value:string,max=256)=>value.replace(/[\u0000-\u001f]/g,' ').slice(0,max);
export function boundBrowserObservation(value:unknown){const text=JSON.stringify(value);return text.length<=1800?text:JSON.stringify({...((value as {untrusted?:boolean})?.untrusted?{untrusted:true}:{}),truncated:true,summary:clip(text,1500)});}
async function boundedNodes(target:Locator){const nodes=[];const count=await target.count();for(let i=0;i<Math.min(count,3);i++){try{nodes.push(await target.nth(i).evaluate(e=>({tag:e.tagName.toLowerCase(),role:(e.getAttribute('role')||'').slice(0,64),testId:(e.getAttribute('data-testid')||'').slice(0,96)}),undefined,{timeout:100}));}catch{nodes.push({unavailable:true});}}return{matchCount:count,nodes,nodesTruncated:count>3};}
type Box = { x: number; y: number; width: number; height: number };
type Variable = { kind: 'count'; value: number } | { kind: 'box'; value: Box; relativeTo?: Loc };
async function box(page: Page, target: Loc, relativeTo?: Loc): Promise<Box> {
  const item = await locator(page, target).boundingBox(); if (!item) throw new Error('Target has no visible bounding box');
  const anchor = relativeTo ? await locator(page, relativeTo).boundingBox() : null;
  if (relativeTo && !anchor) throw new Error('Anchor has no visible bounding box');
  return { ...item, x: item.x - (anchor?.x || 0), y: item.y - (anchor?.y || 0) };
}
async function until(test: () => Promise<boolean>, timeoutMs: number, signal: AbortSignal) {
  const end = Date.now() + timeoutMs;
  do { if (signal.aborted) throw new Error('Browser validation interrupted'); if (await test()) return;
    await new Promise((resolve) => setTimeout(resolve, 20)); } while (Date.now() < end);
  throw new Error('Bounded browser assertion did not match the declared expectation');
}

/** Fixed interpreter: never evals strings or accepts model URLs/JS/commands. */
export async function runBrowserPlan(options: { dist: string; plan: BrowserTestPlanDto; evidenceDir: string; signal: AbortSignal; chromiumSandbox?: boolean }) {
  const plan = BrowserTestPlan.parse(options.plan); await mkdir(options.evidenceDir, { recursive: true });
  const server = createServer(async (req, res) => {
    try {
      const name = decodeURIComponent(new URL(req.url || '/', 'http://app').pathname).slice(1) || 'index.html';
      const target = await safeFile(options.dist, name);
      res.setHeader('content-type', mediaType(name)); res.setHeader('x-content-type-options', 'nosniff');
      res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'");
      res.end(await readFile(target));
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No static browser origin');
  const origin = `http://127.0.0.1:${address.port}`;
  const controller = new AbortController(); let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const stop = () => { controller.abort(); void browser?.close(); };
  options.signal.addEventListener('abort', stop, { once: true });
  const timer = setTimeout(stop, plan.browserBudgetMs);
  let diagnosticBytes=0;const results: Result[] = []; const files: { path: string; kind: 'log' | 'screenshot' }[] = [];
  try {
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      || (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
    browser = await chromium.launch({ headless: true, executablePath, chromiumSandbox: options.chromiumSandbox ?? false, env: browserEnvironment() });
    for (const planned of plan.cases) {
      const logPath = `${planned.id}.log`; const screenshotPath = `${planned.id}.png`;
      const states: Result['steps'] = planned.steps.map((entry) => ({ stepId: entry.id, status: 'not_run' }));
      const log: string[] = []; const evidenceIds = [`evidence_${planned.id}_log`];
      if (controller.signal.aborted) { results.push(CaseResult.parse({ caseId: planned.id, criterionIds: planned.criterionIds,
        status: 'not_run', steps: states, failure: null, reason: 'Browser or Run budget/cancellation interrupted remaining cases.', evidenceIds: [] })); continue; }
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
      const page = await context.newPage(); const errors: string[] = []; const variables = new Map<string, Variable>();
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('frameattached', () => errors.push('Unexpected child frame is forbidden'));
      context.on('page', (popup) => { if (popup !== page) { errors.push('Unexpected popup is forbidden'); void popup.close(); } });
      await page.route('**/*', (route) => route.request().url().startsWith(origin + '/') && route.request().frame() === page.mainFrame() ? route.continue() : route.abort());
      let failed: Result['failure'] = null; let ordinal = 0; let observed:Record<string,unknown>={};let lastDrag:unknown=null;
      try {
        for (ordinal = 0; ordinal < planned.steps.length; ordinal++) {
          const entry = planned.steps[ordinal]; observed={untrusted:true,op:entry.op,...('target'in entry?{locator:entry.target}:{})}; if (controller.signal.aborted) throw new Error('Browser validation interrupted');
          page.setDefaultTimeout(entry.timeoutMs);
          const target = 'target' in entry ? locator(page, entry.target) : null;
          if (target && ['click', 'fill', 'check', 'press', 'drag_by', 'save_box'].includes(entry.op)) {
            observed.matchCount=await target.count();if (observed.matchCount !== 1) throw new Error('Action requires exactly one bounded target');
            await target.waitFor({ state: 'visible', timeout: entry.timeoutMs });
          }
          switch (entry.op) {
            case 'open_current_app': {
              const response = await page.goto(origin, { waitUntil: 'networkidle', timeout: entry.timeoutMs });
              if (!response?.ok()) throw new Error('Current app did not load'); break;
            }
            case 'reload': await page.reload({ waitUntil: 'networkidle', timeout: entry.timeoutMs }); break;
            case 'click': await target!.click(); break;
            case 'fill': await target!.fill(entry.value); break;
            case 'check': await target!.setChecked(entry.checked); break;
            case 'press': await target!.press(entry.key); break;
            case 'save_count': {const count=await target!.count();observed.count=count;variables.set(entry.variable,{kind:'count',value:count});break;}
            case 'save_box': {const value=await box(page,entry.target,entry.relativeTo);observed.box=value;variables.set(entry.variable,{kind:'box',value,...(entry.relativeTo?{relativeTo:entry.relativeTo}:{})});break;}
            case 'drag_by': {
              const position = await target!.boundingBox(); if (!position) throw new Error('Drag target missing');
              const x = position.x + position.width / 2, y = position.y + position.height / 2;
              const hit=await page.evaluate(({x,y})=>{const e=document.elementFromPoint(x,y);return e?{tag:e.tagName.toLowerCase(),role:(e.getAttribute('role')||'').slice(0,64),testId:(e.getAttribute('data-testid')||'').slice(0,96)}:null},{x,y});lastDrag={untrusted:true,target:entry.target,center:{x,y},hit,requestedDelta:{dx:entry.dx,dy:entry.dy}};observed.drag=lastDrag;
              if (x + entry.dx < 0 || x + entry.dx > 1280 || y + entry.dy < 0 || y + entry.dy > 800) throw new Error('Drag exceeds viewport boundary');
              await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + entry.dx, y + entry.dy, { steps: 10 }); await page.mouse.up(); break;
            }
            case 'expect_visible': await until(async()=>{observed.matchCount=await target!.count();const visible=await target!.isVisible();observed.visible=visible;return visible===entry.visible;},entry.timeoutMs,controller.signal);break;
            case 'expect_text': case 'expect_value': await until(async () => {
              const actual=await target!.evaluate((e,input)=>{if(input.op==='expect_value'&&!['INPUT','TEXTAREA','SELECT'].includes(e.tagName))throw new Error('Value assertion requires an input, textarea or select');if(input.op==='expect_text'&&!(e instanceof HTMLElement))throw new Error('Text assertion requires an HTMLElement');const value=input.op==='expect_value'?String((e as HTMLInputElement).value??''):String((e as HTMLElement).innerText??'');return{matched:input.comparison==='exact'?value===input.value:value.includes(input.value),sample:value.slice(0,256),length:value.length,truncated:value.length>256};},{op:entry.op,comparison:entry.comparison,value:entry.value});observed.value=actual;return actual.matched;
            }, entry.timeoutMs, controller.signal); break;
            case 'expect_count': {
              const saved = entry.expected.kind === 'offset' ? variables.get(entry.expected.variable) : undefined;
              const expected = entry.expected.kind === 'literal' ? entry.expected.value : saved?.kind === 'count' ? saved.value + entry.expected.offset : -1;
              if (expected < 0) throw new Error('Invalid count baseline');
              observed.expectedCount=expected;await until(async()=>{const count=await target!.count();observed.count=count;return count===expected;},entry.timeoutMs,controller.signal);break;
            }
            case 'expect_box_moved': case 'expect_box_same': {
              const baseline = variables.get(entry.baseline); if (baseline?.kind !== 'box') throw new Error('Invalid box baseline');
              await until(async () => {
                const actual = await box(page, entry.target, baseline.relativeTo);
                const dx = entry.op === 'expect_box_moved' ? entry.dx : 0, dy = entry.op === 'expect_box_moved' ? entry.dy : 0;observed.baseline=baseline.value;observed.box=actual;observed.delta={dx:actual.x-baseline.value.x,dy:actual.y-baseline.value.y};observed.expectedDelta={dx,dy};observed.expectedPosition={x:baseline.value.x+dx,y:baseline.value.y+dy};observed.lastDrag=lastDrag;
                return Math.abs(actual.x - baseline.value.x - dx) <= entry.tolerancePx && Math.abs(actual.y - baseline.value.y - dy) <= entry.tolerancePx;
              }, entry.timeoutMs, controller.signal); break;
            }
          }
          if (errors.length) throw new Error('Application runtime/frame boundary error: ' + errors[0].slice(0, 500));
          states[ordinal].status = 'passed'; log.push(JSON.stringify({ stepId: entry.id, op: entry.op, status: 'passed' }));
        }
      } catch (error) {
        const index = Math.min(ordinal, planned.steps.length - 1); states[index].status = 'failed';
        const entry=planned.steps[index];if('target'in entry)try{const selected=locator(page,entry.target);observed={...observed,...await boundedNodes(selected)};if(observed.matchCount===1&&['click','check'].includes(entry.op)){const r=await selected.boundingBox();if(r){const point={x:r.x+r.width/2,y:r.y+r.height/2};observed.actionCenter={...point,hit:await page.evaluate(p=>{const e=document.elementFromPoint(p.x,p.y);return e?{tag:e.tagName.toLowerCase(),role:(e.getAttribute('role')||'').slice(0,64),testId:(e.getAttribute('data-testid')||'').slice(0,96)}:null},point)};}}}catch{observed.observationUnavailable=true;}
        failed = { stepId: entry.id, message: clip(error instanceof Error?error.message:'Browser validation failed',512), expected:boundBrowserObservation({frozenStep:entry}),actual:boundBrowserObservation({...observed,...(lastDrag?{lastDrag}:{})}) };
        log.push(JSON.stringify({ stepId: failed.stepId, status: 'failed', message: failed.message,expected:failed.expected,actual:failed.actual }));
      }
      const logText=log.join('\n')+'\n';const bytes=Buffer.byteLength(logText);if(bytes>65536||diagnosticBytes+bytes>262144)throw new Error('Bounded browser diagnostic byte budget exceeded');diagnosticBytes+=bytes;await writeFile(path.join(options.evidenceDir, logPath), logText); files.push({ path: logPath, kind: 'log' });
      if (!controller.signal.aborted) try { await page.screenshot({ path: path.join(options.evidenceDir, screenshotPath), fullPage: true }); files.push({ path: screenshotPath, kind: 'screenshot' }); evidenceIds.push(`evidence_${planned.id}_screenshot`); } catch { }
      results.push(CaseResult.parse({ caseId: planned.id, criterionIds: planned.criterionIds, status: failed ? 'failed' : 'passed',
        steps: states, failure: failed, reason: null, evidenceIds }));
      await context.close().catch(() => {});
    }
  } finally { clearTimeout(timer); options.signal.removeEventListener('abort', stop); await browser?.close().catch(() => {});
    server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  return { caseResults: results, files, interrupted: controller.signal.aborted };
}
