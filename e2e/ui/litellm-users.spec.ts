import { expect, test } from '@playwright/test';
import { devLogin, uniqueEmail } from './helpers';

test.describe('admin: LiteLLM users', () => {
  test('search by e-mail shows the LiteLLM account with its LiteLite match', async ({ page }) => {
    const email = uniqueEmail('test-llsearch');
    await devLogin(page, { email, name: 'Test LiteLLM Search Admin', admin: true });

    await page.getByTestId('nav-admin-litellm-users').click();
    await expect(page.getByTestId('page-admin-litellm-users')).toBeVisible();
    await page.getByTestId('input-litellm-user-search').fill(email.slice(0, 12));
    await page.getByTestId('btn-litellm-user-search').click();

    const row = page.getByTestId('table-litellm-users').locator('tr', { hasText: email });
    const error = page.getByTestId('litellm-users-error');
    await expect(row.or(error).first()).toBeVisible();
    test.skip(await error.isVisible(), 'LiteLLM refused the user list (LITELLM_API_KEY lacks proxy admin rights)');

    await expect(row.getByTestId('litellm-user-email')).toHaveText(email);
    await expect(row.getByTestId('litellm-user-name')).toHaveText('Test LiteLLM Search Admin');
    await expect(row.getByTestId('litellm-user-litelite-status')).toHaveAttribute('data-status', 'active');
  });
});
