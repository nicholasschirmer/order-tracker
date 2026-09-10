import { expect, test } from '@playwright/test';
import {
  ACME_LINES,
  createOrderViaApi,
  fillOrderForm,
  GUID,
  screenshot,
  setStatusViaApi,
  submitOrderViaUi,
  uniqueRef,
} from './helpers';

test.describe('order submission', () => {
  test('S01 submitting a valid new order lands on its detail page with a success notice', async ({ page }) => {
    const ref = uniqueRef('S01');
    await page.goto('/orders/new');
    await fillOrderForm(page, { clientReference: ref, customerName: 'Acme Ltd', lines: ACME_LINES });
    await expect(page.getByTestId('running-total')).toHaveText('25.00');
    await screenshot(page, '02-new-order-filled');

    await page.getByTestId('submit').click();

    await expect(page).toHaveURL(new RegExp(`/orders/${GUID}\\?notice=created$`));
    const notice = page.getByTestId('notice');
    await expect(notice).toHaveAttribute('data-kind', 'success');
    await expect(notice).toContainText(/order submitted/i);
    await expect(page.getByTestId('detail-reference')).toHaveText(ref);
    await expect(page.getByTestId('detail-customer')).toHaveText('Acme Ltd');
    await expect(page.getByTestId('detail-total')).toHaveText('25.00');
    await expect(page.getByTestId('status-badge').first()).toHaveText('Submitted');
    await screenshot(page, '03-order-detail-created');
  });

  test('S02 resubmitting the identical order shows the original instead of creating a duplicate', async ({ page, request }) => {
    const order = { clientReference: uniqueRef('S02'), customerName: 'Acme Ltd', lines: ACME_LINES };

    await submitOrderViaUi(page, order);
    await expect(page).toHaveURL(/notice=created$/);
    const firstUrl = page.url();
    const firstId = firstUrl.match(GUID)![0];

    await submitOrderViaUi(page, order);

    await expect(page).toHaveURL(new RegExp(`/orders/${firstId}\\?notice=replayed$`));
    const notice = page.getByTestId('notice');
    await expect(notice).toHaveAttribute('data-kind', 'info');
    await expect(notice).toContainText(/already been submitted/i);
    await expect(notice).toContainText(/no duplicate/i);
    await screenshot(page, '04-order-detail-replayed');

    const list = await (await request.get(`/api/orders?search=${order.clientReference}`)).json();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(firstId);
  });

  test('S03 resubmitting the same reference with different details is rejected with a link to the existing order', async ({
    page,
    request,
  }) => {
    const ref = uniqueRef('S03');
    const existing = await createOrderViaApi(request, { clientReference: ref, customerName: 'Acme Ltd', lines: ACME_LINES });

    await submitOrderViaUi(page, {
      clientReference: ref,
      customerName: 'Globex Inc',
      lines: [{ product: 'Gadget', quantity: 1, unitPrice: 99.99 }],
    });

    await expect(page).toHaveURL(/\/orders\/new$/);
    const banner = page.getByTestId('error-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(ref);
    await expect(banner).toContainText(/different details/i);
    await screenshot(page, '05-new-order-conflict');

    await banner.getByRole('link', { name: /existing order/i }).click();
    await expect(page).toHaveURL(new RegExp(`/orders/${existing.id}$`));
    await expect(page.getByTestId('detail-customer')).toHaveText('Acme Ltd');

    const list = await (await request.get(`/api/orders?search=${ref}`)).json();
    expect(list).toHaveLength(1);
  });

  test('S06 the form blocks submission and shows inline errors until required fields are valid', async ({ page }) => {
    await page.goto('/orders/new');
    const submit = page.getByTestId('submit');
    await expect(submit).toBeDisabled();

    // Touch each field without providing a value.
    await page.getByLabel('Client reference').fill('x');
    await page.getByLabel('Client reference').fill('');
    await page.getByLabel('Customer').fill('   ');
    const row = page.getByTestId('line-row').first();
    await row.getByTestId('line-product').fill('x');
    await row.getByTestId('line-product').fill('');
    await row.getByTestId('line-quantity').fill('0');
    await row.getByTestId('line-unit-price').fill('-1');
    await page.getByLabel('Client reference').focus(); // blur the last input

    await expect(page.locator('.field-error')).toHaveCount(5);
    await expect(page.getByText('Client reference is required.')).toBeVisible();
    await expect(page.getByText('Customer name is required.')).toBeVisible();
    await expect(page.getByText('Product is required.')).toBeVisible();
    await expect(page.getByText('Quantity must be greater than zero.')).toBeVisible();
    await expect(page.getByText('Unit price cannot be negative.')).toBeVisible();
    await expect(submit).toBeDisabled();
    await screenshot(page, '06-new-order-validation');

    await fillOrderForm(page, { clientReference: uniqueRef('S06'), customerName: 'Acme Ltd', lines: ACME_LINES });
    await expect(page.locator('.field-error')).toHaveCount(0);
    await expect(submit).toBeEnabled();
  });
});

test.describe('viewing orders', () => {
  test('S09 the list shows orders newest first with status badges', async ({ page, request }) => {
    const a = await createOrderViaApi(request, { clientReference: uniqueRef('S09A'), customerName: 'Acme Ltd', lines: ACME_LINES });
    const b = await createOrderViaApi(request, { clientReference: uniqueRef('S09B'), customerName: 'Initech', lines: ACME_LINES });
    const c = await createOrderViaApi(request, {
      clientReference: uniqueRef('S09C'),
      customerName: 'Globex Inc',
      lines: [{ product: 'Gadget', quantity: 1, unitPrice: 99.99 }, { product: 'Gizmo', quantity: 2, unitPrice: 0.01 }],
    });

    await page.goto('/orders');
    const rows = page.getByTestId('order-row');
    await expect(rows.nth(0)).toContainText(c.clientReference);
    await expect(rows.nth(0)).toContainText('Globex Inc');
    await expect(rows.nth(0)).toContainText('100.01');
    await expect(rows.nth(0).getByTestId('status-badge')).toHaveText('Submitted');
    await expect(rows.nth(1)).toContainText(b.clientReference);
    await expect(rows.nth(2)).toContainText(a.clientReference);
    // Only the header nav offers "New order" — no duplicate button on the page itself.
    await expect(page.getByRole('link', { name: /new order/i })).toHaveCount(1);
    await screenshot(page, '07-orders-list');
  });

  test('S11 filtering by status only shows matching orders', async ({ page, request }) => {
    const submitted = await createOrderViaApi(request, { clientReference: uniqueRef('S11S'), customerName: 'Acme Ltd', lines: ACME_LINES });
    const approved = await createOrderViaApi(request, { clientReference: uniqueRef('S11A'), customerName: 'Acme Ltd', lines: ACME_LINES });
    await setStatusViaApi(request, approved.id, 'Approved');

    await page.goto('/orders');
    await page.getByTestId('status-filter').selectOption('Approved');

    const rows = page.getByTestId('order-row');
    await expect(rows.first()).toContainText(approved.clientReference);
    await expect(page.getByTestId('order-row').filter({ hasText: submitted.clientReference })).toHaveCount(0);
    const badges = await page.getByTestId('status-badge').allTextContents();
    expect(badges.every((b) => b === 'Approved')).toBe(true);
    await screenshot(page, '08-orders-list-filtered');

    await page.getByTestId('status-filter').selectOption('Submitted');
    await expect(page.getByTestId('order-row').filter({ hasText: submitted.clientReference })).toHaveCount(1);
    await expect(page.getByTestId('order-row').filter({ hasText: approved.clientReference })).toHaveCount(0);

    await page.getByTestId('clear-filters').click();
    await expect(page.getByTestId('order-row').filter({ hasText: approved.clientReference })).toHaveCount(1);
  });

  test('S12 searching narrows the list to matching references or customers', async ({ page, request }) => {
    const ref = uniqueRef('S12');
    await createOrderViaApi(request, { clientReference: ref, customerName: 'Umbrella Corp', lines: ACME_LINES });

    await page.goto('/orders');
    await page.getByTestId('search').fill('umbrella');
    await page.getByTestId('search').press('Enter');

    await expect(page.getByTestId('order-row')).toHaveCount(1);
    await expect(page.getByTestId('order-row').first()).toContainText(ref);
  });

  test('S13 clicking an order opens its detail page with every line', async ({ page, request }) => {
    const order = await createOrderViaApi(request, {
      clientReference: uniqueRef('S13'),
      customerName: 'Globex Inc',
      lines: [{ product: 'Gadget', quantity: 1, unitPrice: 99.99 }, { product: 'Gizmo', quantity: 2, unitPrice: 0.01 }],
    });

    await page.goto('/orders');
    await page.getByTestId('order-link').filter({ hasText: order.clientReference }).click();

    await expect(page).toHaveURL(new RegExp(`/orders/${order.id}$`));
    await expect(page.getByTestId('detail-reference')).toHaveText(order.clientReference);
    const lines = page.getByTestId('line-row');
    await expect(lines).toHaveCount(2);
    await expect(lines.nth(0)).toContainText('Gadget');
    await expect(lines.nth(0)).toContainText('99.99');
    await expect(lines.nth(1)).toContainText('Gizmo');
    await expect(page.getByTestId('detail-total')).toHaveText('100.01');
    await expect(page.getByTestId('notice')).toHaveCount(0);
  });
});

test.describe('status tracking', () => {
  test('S14 approving an order from the detail page updates the badge and the available actions', async ({ page, request }) => {
    const order = await createOrderViaApi(request, { clientReference: uniqueRef('S14'), customerName: 'Acme Ltd', lines: ACME_LINES });
    await page.goto(`/orders/${order.id}`);
    await expect(page.getByTestId('transition-Approved')).toHaveText('Approve');
    await expect(page.getByTestId('transition-Cancelled')).toHaveText('Cancel');
    await expect(page.getByTestId('transition-Shipped')).toHaveCount(0);

    await page.getByTestId('transition-Approved').click();

    await expect(page.getByTestId('status-badge').first()).toHaveText('Approved');
    await expect(page.getByTestId('notice')).toContainText('Status changed to Approved.');
    await expect(page.getByTestId('transition-Shipped')).toHaveText('Ship');
    await expect(page.getByTestId('transition-Approved')).toHaveCount(0);
    const points = page.getByTestId('timeline-point');
    await expect(points).toHaveText([/Submitted/, /Approved/, /Shipped.*Pending/, /Delivered.*Pending/]);
    await expect(points.nth(1)).toHaveAttribute('data-state', 'current');
    await screenshot(page, '09-order-detail-approved');

    const fetched = await (await request.get(`/api/orders/${order.id}`)).json();
    expect(fetched.status).toBe('Approved');
  });

  test('S15 the full happy path ends Delivered with no further actions', async ({ page, request }) => {
    const order = await createOrderViaApi(request, { clientReference: uniqueRef('S15'), customerName: 'Acme Ltd', lines: ACME_LINES });
    await page.goto(`/orders/${order.id}`);

    await page.getByTestId('transition-Approved').click();
    await expect(page.getByTestId('status-badge').first()).toHaveText('Approved');
    await page.getByTestId('transition-Shipped').click();
    await expect(page.getByTestId('status-badge').first()).toHaveText('Shipped');
    await expect(page.getByTestId('transition-Cancelled')).toHaveCount(0);
    await page.getByTestId('transition-Delivered').click();

    await expect(page.getByTestId('status-badge').first()).toHaveText('Delivered');
    await expect(page.getByTestId('terminal-note')).toContainText(/no further changes/i);
    await expect(page.locator('[data-testid^="transition-"]')).toHaveCount(0);

    // S22: the timeline shows every status reached, each with a timestamp, and nothing pending.
    const points = page.getByTestId('timeline-point');
    await expect(points).toHaveCount(4);
    await expect(points).toHaveText([/Submitted/, /Approved/, /Shipped/, /Delivered/]);
    for (const state of ['done', 'done', 'done', 'current'].entries()) {
      await expect(points.nth(state[0])).toHaveAttribute('data-state', state[1]);
      await expect(points.nth(state[0]).locator('time')).toBeVisible();
    }
    await expect(page.getByText('Pending')).toHaveCount(0);
    await screenshot(page, '10-order-detail-delivered');
  });

  test('S23 a shipped order can be marked lost in transit, which is terminal', async ({ page, request }) => {
    const order = await createOrderViaApi(request, { clientReference: uniqueRef('S23'), customerName: 'Acme Ltd', lines: ACME_LINES });
    await setStatusViaApi(request, order.id, 'Approved');
    await page.goto(`/orders/${order.id}`);

    // Not available before shipping (wait for the page to render its buttons before counting).
    await expect(page.getByTestId('transition-Shipped')).toBeVisible();
    await expect(page.getByTestId('transition-LostInTransit')).toHaveCount(0);
    await page.getByTestId('transition-Shipped').click();
    await expect(page.getByTestId('status-badge').first()).toHaveText('Shipped');
    await expect(page.getByTestId('transition-Delivered')).toHaveText('Mark delivered');
    await expect(page.getByTestId('transition-LostInTransit')).toHaveText('Mark lost in transit');
    await screenshot(page, '12-order-detail-shipped');

    await page.getByTestId('transition-LostInTransit').click();

    await expect(page.getByTestId('status-badge').first()).toHaveText('Lost in transit');
    await expect(page.getByTestId('notice')).toContainText('Status changed to Lost in transit.');
    await expect(page.getByTestId('terminal-note')).toContainText(/lost in transit/i);
    await expect(page.locator('[data-testid^="transition-"]')).toHaveCount(0);
    const points = page.getByTestId('timeline-point');
    await expect(points).toHaveText([/Submitted/, /Approved/, /Shipped/, /Lost in transit/]);
    await expect(points.nth(3)).toHaveAttribute('data-state', 'current');
    await expect(page.getByText('Pending')).toHaveCount(0);
    await screenshot(page, '13-order-detail-lost-in-transit');

    const fetched = await (await request.get(`/api/orders/${order.id}`)).json();
    expect(fetched.status).toBe('LostInTransit');
    expect(fetched.allowedTransitions).toEqual([]);

    // The list filter knows the new status too.
    await page.goto('/orders');
    await page.getByTestId('status-filter').selectOption('LostInTransit');
    await expect(page.getByTestId('order-row').filter({ hasText: order.clientReference })).toHaveCount(1);
  });

  test('S17 cancelling a submitted order is terminal', async ({ page, request }) => {
    const order = await createOrderViaApi(request, { clientReference: uniqueRef('S17'), customerName: 'Acme Ltd', lines: ACME_LINES });
    await page.goto(`/orders/${order.id}`);

    await page.getByTestId('transition-Cancelled').click();

    await expect(page.getByTestId('status-badge').first()).toHaveText('Cancelled');
    await expect(page.getByTestId('terminal-note')).toBeVisible();
    await expect(page.locator('[data-testid^="transition-"]')).toHaveCount(0);

    // S22: cancelled timeline is Submitted → Cancelled with no upcoming steps.
    const points = page.getByTestId('timeline-point');
    await expect(points).toHaveText([/Submitted/, /Cancelled/]);
    await expect(points.nth(1)).toHaveAttribute('data-state', 'current');
    await screenshot(page, '11-order-detail-cancelled');
  });
});
