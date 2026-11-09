/** Explicit synthetic adapter + real host compiler/browser/export. Never a real NLP/model result. */
import { FakeDshAdapter, type AdapterContext, type PlanValue } from '../../src/adapters.js';
import { FakePlanningAdapter, type PlanningContext } from '../../src/delivery-planning.js';
import { compilePlanningRecipes, RECIPE_VERSION } from '../../src/planning-recipes.js';
import { mapModelPlan } from '../../src/planning-format.js';
import { putFile } from '../../src/files.js';
export class ControllerFixturePlanner extends FakePlanningAdapter {
    async plan(context: PlanningContext) {
        context.meter({ modelSteps: 1, inputTokens: 0, outputTokens: 0 });
        context.report('显式synthetic Controller fixture：固定小数显示契约，不代表模型规划。');
        return mapModelPlan(compilePlanningRecipes({ formatVersion: RECIPE_VERSION, criteria: [{ ref: 'r0', description: 'Show decimal 1.5 using an explicit en-US output convention, regardless of browser language.', sourceSeedRefs: context.request.seed.items.map((_, i) => 's' + i), verification: { method: 'automated', recipes: [{ kind: 'text_outcome', actions: [], target: { label: 'Locale result' }, observation: 'text', exact: '1.5' }] } }] }), context.request);
    }
}
export class ControllerFixtureAdapter extends FakeDshAdapter {
    calls = 0;
    constructor(readonly scenario: 'clean_repair' | 'no_change' = 'clean_repair') { super(); }
    async generate(context: AdapterContext, _plan: PlanValue, errors?: string) {
        this.calls++;
        context.meter({ modelSteps: 1, inputTokens: 0, outputTokens: 0 });
        const repaired = Boolean(errors) && this.scenario === 'clean_repair';
        const files = { 'src/main.tsx': `import React from 'react';import{createRoot}from'react-dom/client';import App from './App';createRoot(document.getElementById('root')!).render(<App/>);`, 'src/App.tsx': `export default function App(){const value=new Intl.NumberFormat(${repaired ? "'en-US'" : "undefined"},{minimumFractionDigits:1,maximumFractionDigits:1}).format(1.5);return <main><h1>Synthetic locale fixture</h1><output aria-label="Locale result">{value}</output></main>}` };
        for (const [name, text] of Object.entries(files)) {
            await putFile(context.workspace, name, text);
            context.fileChanged({ path: name, operation: 'modified' });
        }
        return repaired ? 'Synthetic repair explicitly fixes the actual formatter locale' : 'Synthetic initial implementation intentionally uses ambient browser locale';
    }
}
