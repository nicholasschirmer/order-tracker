import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, MOBILE, screenshot } from './helpers';

/**
 * Runs first (single worker, alphabetical file order) against the freshly created database,
 * so this is the only place the empty state can be observed.
 */
test.describe('empty system', () => {
  test('S20 health endpoint reports Healthy through the dev proxy', async ({ request }) => {
    const response = await request.get('/health');
    expect(response.status()).toBe(200);
    expect(await response.text()).toBe('Healthy');
  });

  test('S10 order list shows the empty state with a link to create the first order', async ({ page, request }) => {
    const api = await request.get('/api/orders');
    expect(await api.json()).toEqual([]);

    await page.goto('/');
    await expect(page).toHaveURL(/\/orders$/);
    await expect(page).toHaveTitle(/Orders/);

    const empty = page.getByTestId('empty-state');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText(/no orders yet/i);
    await expect(page.getByTestId('order-row')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await screenshot(page, '01-orders-empty-desktop');

    await page.setViewportSize(MOBILE);
    await expectNoHorizontalOverflow(page);
    await screenshot(page, '01-orders-empty-mobile');

    await empty.getByRole('link', { name: /create the first order/i }).click();
    await expect(page).toHaveURL(/\/orders\/new$/);
  });
});
