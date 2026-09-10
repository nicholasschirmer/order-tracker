import { routes } from './app.routes';

describe('routes', () => {
  it('redirects the root to /orders and defines list, new and detail routes', () => {
    const root = routes.find((r) => r.path === '');
    expect(root?.redirectTo).toBe('orders');
    expect(routes.map((r) => r.path)).toEqual(expect.arrayContaining(['orders', 'orders/new', 'orders/:id']));
    // 'orders/new' must be matched before 'orders/:id' so "new" is never treated as an id.
    expect(routes.findIndex((r) => r.path === 'orders/new')).toBeLessThan(routes.findIndex((r) => r.path === 'orders/:id'));
  });
});
