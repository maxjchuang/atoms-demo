import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test.beforeEach(() => test.skip(process.env.ATOMS_E2E_REAL === '1', 'Source rendering regression uses synthetic Mock data only.'));
async function openCode(page: Page) {
  await page.goto('/'); await expect(page.getByRole('button', { name: '开启体验' })).toBeVisible();
  const subject = await page.evaluate(async () => {
    const post = async (url: string, body: unknown) => {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(await response.text()); return response.json();
    };
    await post('/api/v1/sessions', { code: 'atoms-demo-2026' });
    const project = await post('/api/v1/projects', { title: '源码高亮 Mock 验收' });
    await post(`/api/v1/projects/${project.id}/runs`, { prompt: '创建便签墙', mode: 'build' });
    for (let i = 0; i < 9; i++) await fetch(`/api/v1/projects/${project.id}/events?after=0`);
    return project.id as string;
  });
  await page.goto(`/#/projects/${subject}`); await page.reload();
  await page.getByRole('button', { name: '代码', exact: true }).click();
  await expect(page.locator('.source-code code')).toHaveAttribute('data-language', 'tsx');
}

test('published TSX, CSS and JSON source has visible syntax colors and switches language correctly', async ({ page }) => {
  await openCode(page);
  const code = page.locator('.source-code code');
  await expect(code.locator('.token.keyword').first()).toBeVisible();
  await expect(code.locator('.token.tag').first()).toBeVisible();
  const colors = await code.evaluate(element => ({ base: getComputedStyle(element).color, keyword: getComputedStyle(element.querySelector('.token.keyword')!).color }));
  expect(colors.keyword).not.toBe(colors.base);
  await page.getByRole('button', { name: 'src/styles.css', exact: true }).click();
  await expect(code).toHaveAttribute('data-language', 'css');
  await expect(code.locator('.token.selector')).toContainText('.note');
  await page.getByRole('button', { name: 'package.json', exact: true }).click();
  await expect(code).toHaveAttribute('data-language', 'json');
  await expect(code.locator('.token.property').first()).toContainText('name');
  await expect(code).toContainText('mock-notes');
  await page.getByRole('button', { name: 'src/App.tsx', exact: true }).click();
  await expect(code).toHaveAttribute('data-language', 'tsx');
  await expect(code).toContainText('export default function App()');
  await mkdir('review-artifacts/code-highlighting', { recursive: true });
  await page.screenshot({ path: 'review-artifacts/code-highlighting/tsx-1440.png', fullPage: true });
});

test('HTML is inert text; unsupported and long sources remain exact and can switch back to highlighting', async ({ page }) => {
  const malicious = '<script>window.__sourceExecuted=true</script>\n<img src="invalid" onerror="window.__sourceExecuted=true">\n';
  const plain = '\t<custom> & original  \r\n\n';
  const long = 'const value = 1;\n'.repeat(7000);
  await page.addInitScript(({ malicious, plain, long }) => {
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const response = await original(input, init);
      if (!response.ok) return response;
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (/\/api\/v1\/versions\/[^/]+\/files$/.test(url.pathname)) {
        const value = await response.json();
        value.files.push(...['source/data.custom', 'source/src/long.ts'].map(path => ({ path, bytes: 100, sha256: 'a'.repeat(64), mediaType: 'text/plain' })));
        return Response.json(value);
      }
      if (/\/api\/v1\/versions\/[^/]+\/file$/.test(url.pathname)) {
        const replacement = ({ 'source/index.html': malicious, 'source/data.custom': plain, 'source/src/long.ts': long } as Record<string, string>)[url.searchParams.get('path') ?? ''];
        if (replacement !== undefined) return new Response(replacement, { headers: { 'Content-Type': 'text/plain' } });
      }
      return response;
    };
  }, { malicious, plain, long });
  await openCode(page); const code = page.locator('.source-code code');
  await page.getByRole('button', { name: 'index.html', exact: true }).click();
  await expect(code).toHaveAttribute('data-language', 'markup');
  await expect.poll(() => code.textContent()).toBe(malicious);
  await expect(code.locator('script,img')).toHaveCount(0);
  expect(await page.evaluate(() => '__sourceExecuted' in window)).toBe(false);
  await page.getByRole('button', { name: 'data.custom', exact: true }).click();
  await expect(code).toHaveAttribute('data-language', 'plain');
  await expect.poll(() => code.textContent()).toBe(plain);
  await page.getByRole('button', { name: 'src/long.ts', exact: true }).click();
  await expect(page.getByText('文件较长，以原文显示，避免影响浏览流畅度。')).toBeVisible();
  await expect.poll(() => code.textContent()).toBe(long);
  await expect(code.locator('.token')).toHaveCount(0);
  await page.getByRole('button', { name: 'src/App.tsx', exact: true }).click();
  await expect(code.locator('.token.keyword').first()).toBeVisible();
  await expect(page.locator('.source-highlight-note')).toHaveCount(0);
});

for (const width of [1366, 390]) test(`code scroll stays within its panel at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); await openCode(page);
  await expect(page.locator('.source-code .token.keyword').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await mkdir('review-artifacts/code-highlighting', { recursive: true });
  await page.screenshot({ path: `review-artifacts/code-highlighting/tsx-${width}.png`, fullPage: true });
});
