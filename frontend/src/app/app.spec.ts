import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('renders the app header with the product name and navigation', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('header')?.textContent).toContain('Order Tracker');
    const hrefs = Array.from(el.querySelectorAll<HTMLAnchorElement>('header nav a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/orders', '/orders/new']);
    expect(el.querySelector('main router-outlet')).not.toBeNull();
  });
});
