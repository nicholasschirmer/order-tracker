import { expect, Page, test } from '@playwright/test';
import {
  ACME_LINES,
  createOrderViaApi,
  DESKTOP,
  expectNoHorizontalOverflow,
  MOBILE,
  screenshot,
  setStatusViaApi,
  uniqueRef,
} from './helpers';

/**
 * S21 — every screen renders without horizontal overflow at desktop and phone widths.
 * Screenshots land in e2e/screenshots/layout-*.png for visual review.
 */
const viewports = [
  { name: 'desktop', size: DESKTOP },
  { name: 'mobile', size: MOBILE },
];

async function checkAndShoot(page: Page, name: string) {
  await expectNoHorizontalOverflow(page);
  await screenshot(page, name);
}

for (const vp of viewports) {
  test.describe(`S21 layout at ${vp.name} (${vp.size.width}×${vp.size.height})`, () => {
    test.use({ viewport: vp.size });

    test('order list with data', async ({ page, request }) => {
      const approved = await createOrderViaApi(request, {
        clientReference: uniqueRef(`L${vp.name[0].toUpperCase()}`),
        customerName: 'A Very Long Customer Name Holdings Pty Ltd',
        lines: [{ product: 'Industrial widget, extra large', quantity: 1200, unitPrice: 1234.56 }],
      });
      await setStatusViaApi(request, approved.id, 'Approved');

      await page.goto('/orders');
      const firstRow = page.getByTestId('order-row').first();
      await expect(firstRow).toBeVisible();
      await expect(firstRow).toContainText('1,481,472.00');
      // The whole row, including the total, must fit inside the viewport — no clipped columns.
      const total = firstRow.locator('[data-label="Total"]');
      const box = (await total.boundingBox())!;
      expect(box.x + box.width, 'total column is clipped by the viewport').toBeLessThanOrEqual(vp.size.width);
      // Header nav must stay on one line.
      const nav = (await page.locator('header nav').boundingBox())!;
      expect(nav.height, 'header navigation wraps onto multiple lines').toBeLessThan(48);
      await checkAndShoot(page, `layout-list-${vp.name}`);
    });

    test('new order form with validation errors', async ({ page }) => {
      await page.goto('/orders/new');
      await page.getByTestId('add-line').click();
      await page.getByLabel('Client reference').fill('x');
      await page.getByLabel('Client reference').fill('');
      await page.getByLabel('Customer').fill(' ');
      const row = page.getByTestId('line-row').first();
      await row.getByTestId('line-product').fill('x');
      await row.getByTestId('line-product').fill('');
      await row.getByTestId('line-quantity').fill('0');
      await row.getByTestId('line-unit-price').fill('-1');
      await page.getByLabel('Client reference').focus();
      await expect(page.locator('.field-error').first()).toBeVisible();
      await checkAndShoot(page, `layout-new-order-errors-${vp.name}`);
    });

    test('order detail', async ({ page, request }) => {
      const order = await createOrderViaApi(request, {
        clientReference: uniqueRef(`LD${vp.name[0].toUpperCase()}`),
        customerName: 'Globex Inc',
        lines: [
          { product: 'Gadget with a fairly long descriptive name', quantity: 1, unitPrice: 99.99 },
          { product: 'Gizmo', quantity: 2, unitPrice: 0.01 },
          ...ACME_LINES,
        ],
      });
      await page.goto(`/orders/${order.id}?notice=created`);
      await expect(page.getByTestId('detail-reference')).toBeVisible();
      await checkAndShoot(page, `layout-detail-${vp.name}`);
    });
  });
}
