import ts from 'typescript';
import { canonicalDeliveryJson, type BrowserTestPlanDto } from '@atoms/contracts/delivery';
import { sha256 } from './files.js';
const trusted = Symbol('hash-verified-host-source');
export type SemanticSource = {
    path: string;
    text: string;
    sha256: string;
    readonly [trusted]: true;
};
export function verifiedSemanticSource(path: string, text: string, expectedHash: string): SemanticSource {
    if (path.split('/').some(p => p === '..' || p === '.') || !/^source\/src\/[a-zA-Z0-9_./-]+\.(tsx?|jsx?)$/.test(path) || sha256(text) !== expectedHash)
        throw new Error('Semantic source provenance mismatch');
    return Object.freeze({ path, text, sha256: expectedHash, [trusted]: true as const });
}
type Loc = {
    by: string;
    value?: string;
    role?: string;
    name?: string;
    exact?: boolean;
    nth?: number;
};
const key = (x: Loc) => canonicalDeliveryJson(x);
const hook = (x: Loc) => x.by === 'test_id' ? x.value : null;
type Trigger = {
    target: Loc;
    state: string;
    effect: 'checked' | 'toggle' | boolean;
};
type Condition = {
    state: string;
    positive: boolean;
};
export type SemanticIssue = {
    code: 'COUNT_ON_SCALAR_VALUE' | 'COUNT_ON_INDEXED_LOCATOR' | 'COLLECTION_UNPROVEN' | 'STATE_TRIGGER_UNPROVEN' | 'ACTION_WITHOUT_POSTCONDITION' | 'CASE_WITHOUT_ASSERTION';
    caseId: string;
    stepId: string;
    detail: string;
};
export type PlanSemanticReceipt = {
    policyRevision: 'bounded-observation-v2';
    planHash: string;
    receiptHash: string;
    status: 'policy_pass' | 'known_invalid';
    checkedSteps: string[];
    issues: SemanticIssue[];
    sourceHashes: {
        path: string;
        sha256: string;
    }[];
    scope: string[];
    limitations: string[];
};
function catalogue(sources: SemanticSource[]) {
    if (sources.length > 5 || sources.reduce((n, s) => n + Buffer.byteLength(s.text), 0) > 24576 || sources.some(s => s[trusted] !== true || sha256(s.text) !== s.sha256))
        throw new Error('Untrusted or oversized semantic source evidence');
    const collections = new Set<string>(), scalars = new Set<string>(), initial = new Map<string, boolean>(), conditions = new Map<string, Condition[]>(), triggers: Trigger[] = [];
    for (const source of sources) {
        const file = ts.createSourceFile(source.path, source.text, ts.ScriptTarget.Latest, true, source.path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
        const arrays = new Set<string>(), numbers = new Set<string>(), setters = new Map<string, string>(), stateNames = new Set<string>();
        let nodes = 0;
        const scope = (n: ts.Node): ts.Node => { let p = n.parent; while (p && !ts.isFunctionLike(p) && !ts.isSourceFile(p))
            p = p.parent; return p || file; };
        const local = (name: string, n: ts.Node) => source.path + ':' + scope(n).pos + ':' + name;
        const resolve = (name: string, n: ts.Node, has: (key: string) => boolean) => { let p: ts.Node | undefined = n; while (p) {
            if (ts.isFunctionLike(p) || ts.isSourceFile(p)) {
                const k = source.path + ':' + p.pos + ':' + name;
                if (has(k))
                    return k;
            }
            p = p.parent;
        } return null; };
        const addCondition = (id: string, state: string, positive: boolean) => conditions.set(id, [...(conditions.get(id) || []), { state, positive }]);
        const walk = (node: ts.Node, fn: (n: ts.Node) => void) => { if (++nodes > 20000)
            throw new Error('Semantic AST evidence limit exceeded'); fn(node); ts.forEachChild(node, n => walk(n, fn)); };
        walk(file, n => { if (ts.isParameter(n) && ts.isIdentifier(n.name) && n.type && ts.isArrayTypeNode(n.type))
            arrays.add(local(n.name.text, n)); if (!ts.isVariableDeclaration(n) || !n.initializer)
            return; if (ts.isIdentifier(n.name) && ts.isArrayLiteralExpression(n.initializer))
            arrays.add(local(n.name.text, n)); if (ts.isArrayBindingPattern(n.name) && ts.isCallExpression(n.initializer) && ts.isIdentifier(n.initializer.expression) && n.initializer.expression.text === 'useState') {
            const names = n.name.elements.map(e => ts.isBindingElement(e) && ts.isIdentifier(e.name) ? e.name.text : null);
            const arg = n.initializer.arguments[0];
            if (names[0] && names[1]) {
                const state = local(names[0], n);
                stateNames.add(state);
                setters.set(local(names[1], n), state);
                if (arg?.kind === ts.SyntaxKind.TrueKeyword || arg?.kind === ts.SyntaxKind.FalseKeyword)
                    initial.set(state, arg.kind === ts.SyntaxKind.TrueKeyword);
                if (arg && ts.isNumericLiteral(arg))
                    numbers.add(state);
                if (arg && ts.isArrayLiteralExpression(arg) || n.initializer.typeArguments?.some(t => ts.isArrayTypeNode(t)))
                    arrays.add(state);
            }
        }
        else if (ts.isIdentifier(n.name) && ts.isNumericLiteral(n.initializer))
            numbers.add(local(n.name.text, n)); });
        nodes = 0;
        walk(file, n => {
            if (!ts.isJsxElement(n) && !ts.isJsxSelfClosingElement(n))
                return;
            const open = ts.isJsxElement(n) ? n.openingElement : n;
            const attrs = new Map<string, ts.JsxAttribute>();
            for (const a of open.attributes.properties)
                if (ts.isJsxAttribute(a))
                    attrs.set(a.name.getText(file), a);
            const literal = (name: string) => { const v = attrs.get(name)?.initializer; return v && ts.isStringLiteral(v) ? v.text : null; };
            const id = literal('data-testid');
            const children: readonly ts.JsxChild[] = ts.isJsxElement(n) ? n.children : [];
            if (id && (['output', 'meter', 'progress'].includes(open.tagName.getText(file)) || open.tagName.getText(file) === 'input' && ['number', 'range'].includes(literal('type') || '') || attrs.has('aria-valuenow')))
                scalars.add(id);
            if (id) {
                let parent: ts.Node | undefined = n.parent;
                while (parent) {
                    if (ts.isCallExpression(parent) && ts.isPropertyAccessExpression(parent.expression) && parent.expression.name.text === 'map' && (ts.isArrayLiteralExpression(parent.expression.expression) || ts.isIdentifier(parent.expression.expression) && !!resolve(parent.expression.expression.text, parent, k => arrays.has(k))))
                        collections.add(id);
                    if (ts.isConditionalExpression(parent)) {
                        const c = parent.condition;
                        if (ts.isIdentifier(c) && setters.size)
                            addCondition(id, resolve(c.text, c, k => stateNames.has(k)) || source.path + ':unknown:' + c.text, parent.whenTrue.pos <= n.pos && parent.whenTrue.end >= n.end);
                    }
                    if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && ts.isIdentifier(parent.left))
                        addCondition(id, resolve(parent.left.text, parent.left, k => stateNames.has(k)) || source.path + ':unknown:' + parent.left.text, true);
                    parent = parent.parent;
                }
                for (const child of children)
                    if (ts.isJsxExpression(child) && child.expression && (ts.isNumericLiteral(child.expression) || (ts.isIdentifier(child.expression) && !!resolve(child.expression.text, child.expression, k => numbers.has(k))) || (ts.isPropertyAccessExpression(child.expression) && child.expression.name.text === 'length')))
                        scalars.add(id);
            }
            const targets: Loc[] = [];
            if (id)
                targets.push({ by: 'test_id', value: id });
            const tag = open.tagName.getText(file);
            let names: string[] = [];
            const aria = literal('aria-label');
            if (aria)
                names = [aria];
            else {
                const text = children.filter((t): t is ts.JsxText => ts.isJsxText(t)).map(t => t.text.trim()).filter(Boolean).join(' ').trim();
                if (text)
                    names = [text];
                for (const child of children)
                    if (ts.isJsxExpression(child) && child.expression && ts.isConditionalExpression(child.expression)) {
                        for (const branch of [child.expression.whenTrue, child.expression.whenFalse])
                            if (ts.isStringLiteral(branch))
                                names.push(branch.text);
                    }
            }
            if (tag === 'input' && literal('type') === 'checkbox' && !names.length && ts.isJsxElement(n.parent) && n.parent.openingElement.tagName.getText(file) === 'label')
                names = n.parent.children.filter((t): t is ts.JsxText => ts.isJsxText(t)).map(t => t.text.trim()).filter(Boolean);
            if (tag === 'button' || tag === 'input' && literal('type') === 'checkbox')
                for (const name of names.filter(x => x.length <= 240))
                    targets.push({ by: 'role', role: tag === 'button' ? 'button' : 'checkbox', name, exact: true });
            for (const event of ['onClick', 'onChange']) {
                const expr = attrs.get(event)?.initializer;
                if (!expr || !ts.isJsxExpression(expr) || !expr.expression || !ts.isArrowFunction(expr.expression))
                    continue;
                let body: ts.Node = expr.expression.body;
                if (ts.isBlock(body)) {
                    if (body.statements.length !== 1 || !ts.isExpressionStatement(body.statements[0]))
                        continue;
                    body = body.statements[0].expression;
                }
                if (!ts.isCallExpression(body) || !ts.isIdentifier(body.expression) || !resolve(body.expression.text, body, k => setters.has(k)))
                    continue;
                const a = body.arguments[0];
                let effect: Trigger['effect'] | undefined;
                if (a?.kind === ts.SyntaxKind.TrueKeyword || a?.kind === ts.SyntaxKind.FalseKeyword)
                    effect = a.kind === ts.SyntaxKind.TrueKeyword;
                else if (a && event === 'onChange' && tag === 'input' && literal('type') === 'checkbox' && ts.isPropertyAccessExpression(a) && a.name.text === 'checked' && ts.isPropertyAccessExpression(a.expression) && ['target', 'currentTarget'].includes(a.expression.name.text) && ts.isIdentifier(a.expression.expression) && ts.isIdentifier(expr.expression.parameters[0]?.name) && a.expression.expression.text === expr.expression.parameters[0].name.text)
                    effect = 'checked';
                else if (a && ts.isArrowFunction(a) && ts.isPrefixUnaryExpression(a.body) && a.body.operator === ts.SyntaxKind.ExclamationToken && ts.isIdentifier(a.body.operand) && ts.isIdentifier(a.parameters[0]?.name) && a.body.operand.text === a.parameters[0].name.text)
                    effect = 'toggle';
                else if (a && ts.isPrefixUnaryExpression(a) && a.operator === ts.SyntaxKind.ExclamationToken && ts.isIdentifier(a.operand) && resolve(a.operand.text, a, k => stateNames.has(k)) === setters.get(resolve(body.expression.text, body, k => setters.has(k))!))
                    effect = 'toggle';
                if (effect !== undefined)
                    for (const target of targets)
                        triggers.push({ target, state: setters.get(resolve(body.expression.text, body, k => setters.has(k))!)!, effect });
            }
        });
    }
    return { collections, scalars, initial, conditions, triggers };
}
/** Limited host policy, never a proof of arbitrary natural-language goal truth. */
export function reviewPlanSemantics(plan: BrowserTestPlanDto, sources: SemanticSource[] = []): PlanSemanticReceipt {
    const c = catalogue(sources), issues: SemanticIssue[] = [], checkedSteps: string[] = [];
    const issue = (code: SemanticIssue['code'], caseId: string, stepId: string, detail: string) => issues.push({ code, caseId, stepId, detail });
    for (const test of plan.cases) {
        if (!test.steps.some(s => ['expect_visible', 'expect_text', 'expect_value', 'expect_count', 'expect_box_moved', 'expect_box_same'].includes(s.op)))
            issue('CASE_WITHOUT_ASSERTION', test.id, test.steps[0].id, 'An automated case must contain an observable expected result, not only setup/dispatch.');
        const actions = test.steps.map((s, i) => ({ s, i })).filter(({ s }) => ['click', 'check', 'press', 'fill', 'drag_by'].includes(s.op));
        const state = new Map(c.initial), triggerAt=new Map<string,number>();const effects:number[]=[];const passive:{stepId:string;at:number}[]=[];
        let acted = false;
        for (const [stepIndex,step] of test.steps.entries()) {
            checkedSteps.push(step.id);
            if (step.op === 'open_current_app')
                continue;
            const loc = 'target' in step ? step.target : null;
            if (step.op === 'save_count' || step.op === 'expect_count') {
                const id = hook(step.target);
                if (step.target.nth !== undefined)
                    issue('COUNT_ON_INDEXED_LOCATOR', test.id, step.id, 'DOM cardinality cannot measure a selected singleton.');
                else if (id && c.scalars.has(id))
                    issue('COUNT_ON_SCALAR_VALUE', test.id, step.id, 'This hash-verified source renders a scalar value; DOM count cannot compare its numeric text.');
                else if (!(step.target.by === 'role' && ['listitem', 'article', 'option'].includes(step.target.role)) && !(id && c.collections.has(id)))
                    issue('COLLECTION_UNPROVEN', test.id, step.id, 'No host-verifiable collection semantics; use a structural collection locator or retain required manual/unsupported coverage.');
            }
            if (['click', 'check', 'press', 'fill', 'drag_by'].includes(step.op) && loc) {
                acted = true;

                for (const trigger of c.triggers.filter(t => key(t.target) === key(loc))) {triggerAt.set(trigger.state,stepIndex);
                    if (trigger.effect === 'checked' && step.op === 'check')
                        state.set(trigger.state, step.checked);
                    else if (typeof trigger.effect === 'boolean')
                        state.set(trigger.state, trigger.effect);
                    else if (trigger.effect === 'toggle' && state.has(trigger.state))
                        state.set(trigger.state, !state.get(trigger.state));
                }
            }
            if (step.op === 'expect_visible') {
                const id = hook(step.target), condition = id ? c.conditions.get(id) : undefined;
                if (condition) {
                    const values = condition.map(c => { const v = state.get(c.state); return v === undefined ? null : c.positive ? v : !v; });
                    const known = values.includes(false) ? false : values.includes(null) ? null : true;
                    if (known === null || known !== step.visible)
                        issue('STATE_TRIGGER_UNPROVEN', test.id, step.id, 'No proven initial/explicit control transition reaches the requested conditional state; natural time is not a deterministic fixture.');
                    else if(condition.some(x=>triggerAt.has(x.state)))effects.push(stepIndex);
                }
                else if(acted) passive.push({stepId:step.id,at:stepIndex});
            }
            if(['expect_text','expect_value','expect_count','expect_box_moved','expect_box_same'].includes(step.op))effects.push(stepIndex);
        }
        for(const {s,i} of actions)if(!effects.some(at=>at>i))issue('ACTION_WITHOUT_POSTCONDITION',test.id,s.id,'Action dispatch/passive visibility alone cannot prove its effect; use a real text/value/collection/geometry assertion or a source-proven control transition.');
        for(const p of passive)if(!effects.some(at=>actions.some(a=>at>a.i)))issue('STATE_TRIGGER_UNPROVEN',test.id,p.stepId,'This visibility observation has no proven state trigger and is not accompanied by a measured effect. Keep a static invariant before actions, or retain unknown state coverage as required manual/unsupported.');
    }
    const body = { policyRevision: 'bounded-observation-v2' as const, planHash: plan.hash, status: issues.length ? 'known_invalid' as const : 'policy_pass' as const, checkedSteps, issues, sourceHashes: sources.map(s => ({ path: s.path, sha256: s.sha256 })), scope: ['DOM cardinality versus scalar values', 'indexed collection misuse', 'finite initial/direct-control conditional visibility', 'action dispatch versus observable postcondition'], limitations: ['Not arbitrary natural-language semantic proof', 'A postcondition is required but arbitrary goal-to-assertion causality is not universally proved', 'Numeric HUD comparison/increase has no supported numeric DSL operation', 'Natural-time terminal reachability is not proved', 'Unknown visibility may be a passive invariant only, not a causal/terminal-state proof','Source evidence is bounded; unknown conditional transitions remain unsupported'] };
    return { ...body, receiptHash: sha256(canonicalDeliveryJson(body)) };
}
