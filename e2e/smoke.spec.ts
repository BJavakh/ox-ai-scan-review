import { expect, test } from '@playwright/test';

test('scan a repository end to end and read the report', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { level: 1, name: 'See what to fix first' }),
  ).toBeVisible();

  await page.getByLabel('Repository URL').fill('demo/vulnerable-app');
  await expect(page.getByText('Will scan demo/vulnerable-app on the default branch')).toBeVisible();
  await page.getByRole('button', { name: 'Scan repository' }).click();

  // Progress screen, then the report replaces it in place.
  await expect(page.getByRole('group', { name: 'Scan steps' })).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 1, name: /demo\/vulnerable-app/i }),
  ).toBeVisible();
  await expect(page.getByText('Critical risk').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Start by upgrading minimist to 1\.2\.6/)).toBeVisible();
  await expect(page).toHaveTitle(/demo\/vulnerable-app · Critical risk/);

  // Fix first: highest-priority upgrade is the production critical, with its command.
  const firstAction = page.locator('.action-row').first();
  await expect(firstAction.getByRole('heading', { name: /minimist/ })).toBeVisible();
  await expect(firstAction.getByText('npm update minimist')).toBeVisible();
  await firstAction.getByText('What this upgrade fixes').click();
  await expect(firstAction.getByText('Prototype Pollution in minimist')).toBeVisible();

  // Findings: search narrows the table.
  await page.getByPlaceholder('Search package, CVE or text').fill('lodash');
  await expect(page.getByText('6 findings of 57')).toBeVisible();
});

test('rejects a non-GitHub URL before creating a scan', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Repository URL').fill('https://gitlab.com/a/b');
  await page.getByRole('button', { name: 'Scan repository' }).click();
  await expect(page.getByRole('alert')).toHaveText('Only github.com repositories are supported.');
  await expect(page).toHaveURL(/#?\/?$/);
});

test('explains a failed scan', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Repository URL').fill('https://github.com/demo/python-only');
  await page.getByRole('button', { name: 'Scan repository' }).click();
  await expect(page.getByText(/No package-lock\.json or package\.json was found/)).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText('NO_SUPPORTED_MANIFEST')).toBeVisible();
});
