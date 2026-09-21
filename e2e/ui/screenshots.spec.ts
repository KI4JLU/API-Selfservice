import { expect, test } from '@playwright/test';
import { devLogin, uniqueEmail } from './helpers';

/** Captures reference screenshots (light + dark) of the dashboard and the keys page into test-results/. */
test('screenshots of dashboard and keys page', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await devLogin(page, { email: uniqueEmail('shot'), name: 'Screenshot User' });
  await expect(page.getByTestId('budget-cards')).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: testInfo.outputPath('dashboard-light.png'), fullPage: true });
  await page.getByTestId('btn-user-menu').click();
  await page.getByTestId('btn-theme').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: testInfo.outputPath('dashboard-dark.png'), fullPage: true });

  await page.getByTestId('nav-keys').click();
  await expect(page.getByTestId('page-keys')).toBeVisible();
  await page.getByTestId('btn-create-key').click();
  await expect(page.getByTestId('dialog-create-key')).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: testInfo.outputPath('keys-dark-dialog.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await page.getByTestId('btn-user-menu').click();
  await page.getByTestId('btn-theme').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: testInfo.outputPath('keys-light.png'), fullPage: true });

  await page.setViewportSize({ width: 375, height: 800 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: testInfo.outputPath('keys-mobile.png'), fullPage: true });
  await page.getByTestId('btn-sidebar-toggle').click();
  await expect(page.locator('[data-sidebar="sidebar"][data-mobile="true"]')).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: testInfo.outputPath('mobile-nav.png') });
});
