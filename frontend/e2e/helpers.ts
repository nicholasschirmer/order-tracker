import { APIRequestContext, expect, Page } from '@playwright/test';
import path from 'node:path';

export const SCREENSHOT_DIR = path.resolve(__dirname, 'screenshots');

export const DESKTOP = { width: 1280, height: 800 };
export const MOBILE = { width: 390, height: 844 };

let counter = 0;
/** Unique client reference so tests never collide, even across re-runs on the same database. */
export function uniqueRef(prefix = 'PO'): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${counter}`;
}

export interface LineInput {
  product: string;
  quantity: number;
  unitPrice: number;
}

export interface OrderInput {
  clientReference: string;
  customerName: string;
  lines: LineInput[];
}

export const ACME_LINES: LineInput[] = [{ product: 'Widget', quantity: 10, unitPrice: 2.5 }];

export async function createOrderViaApi(request: APIRequestContext, order: OrderInput) {
  const response = await request.post('/api/orders', { data: order });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as { id: string; clientReference: string; status: string };
}

export async function setStatusViaApi(request: APIRequestContext, id: string, status: string) {
  const response = await request.patch(`/api/orders/${id}/status`, { data: { status } });
  expect(response.status(), await response.text()).toBe(200);
}

/** Fills the New Order form. Does not submit. */
export async function fillOrderForm(page: Page, order: OrderInput) {
  await page.getByLabel('Client reference').fill(order.clientReference);
  await page.getByLabel('Customer').fill(order.customerName);
  for (let i = 0; i < order.lines.length; i++) {
    if (i > 0) await page.getByTestId('add-line').click();
    const row = page.getByTestId('line-row').nth(i);
    await row.getByTestId('line-product').fill(order.lines[i].product);
    await row.getByTestId('line-quantity').fill(String(order.lines[i].quantity));
    await row.getByTestId('line-unit-price').fill(String(order.lines[i].unitPrice));
  }
}

export async function submitOrderViaUi(page: Page, order: OrderInput) {
  await page.goto('/orders/new');
  await fillOrderForm(page, order);
  await page.getByTestId('submit').click();
}

export async function screenshot(page: Page, name: string) {
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`), fullPage: true });
}

/** S21: the page body must never scroll sideways. */
export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth, `page overflows horizontally: ${JSON.stringify(overflow)}`).toBeLessThanOrEqual(
    overflow.clientWidth,
  );
}

export const GUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
