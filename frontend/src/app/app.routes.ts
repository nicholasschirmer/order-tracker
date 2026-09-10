import { Routes } from '@angular/router';
import { OrderList } from './orders/order-list/order-list';
import { NewOrder } from './orders/new-order/new-order';
import { OrderDetail } from './orders/order-detail/order-detail';

export const routes: Routes = [
  { path: '', redirectTo: 'orders', pathMatch: 'full' },
  { path: 'orders', component: OrderList, title: 'Orders · Order Tracker' },
  // Must precede 'orders/:id' so that "new" is never interpreted as an id.
  { path: 'orders/new', component: NewOrder, title: 'New order · Order Tracker' },
  { path: 'orders/:id', component: OrderDetail, title: 'Order · Order Tracker' },
  { path: '**', redirectTo: 'orders' },
];
