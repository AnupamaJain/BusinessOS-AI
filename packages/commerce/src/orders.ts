import type { Order, OrderItem, OrderStatus } from './types';
import { randomUUID } from 'crypto';

export class OrderService {
  private ordersStore: Order[] = [];

  public createOrder(params: {
    organizationId: string;
    contactId: string;
    items: Array<{ productId: string; title: string; unitPrice: number; quantity: number }>;
    discountAmount?: number;
    taxAmount?: number;
    currency?: string;
  }): Order {
    const orderItems: OrderItem[] = params.items.map(item => ({
      productId: item.productId,
      title: item.title,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      totalPrice: item.unitPrice * item.quantity
    }));

    const subtotal = orderItems.reduce((sum, item) => sum + item.totalPrice, 0);
    const discount = params.discountAmount ?? 0;
    const tax = params.taxAmount ?? 0;
    const totalAmount = Math.max(0, subtotal - discount + tax);

    const orderNumber = `ORD-${Math.floor(100000 + Math.random() * 900000)}`;

    const order: Order = {
      id: randomUUID(),
      organizationId: params.organizationId,
      contactId: params.contactId,
      orderNumber,
      subtotal,
      taxAmount: tax,
      discountAmount: discount,
      totalAmount,
      currency: params.currency ?? 'INR',
      status: 'created',
      items: orderItems,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.ordersStore.push(order);
    return order;
  }

  public updateOrderStatus(orderId: string, status: OrderStatus): Order | undefined {
    const order = this.ordersStore.find(o => o.id === orderId);
    if (order) {
      order.status = status;
      order.updatedAt = new Date().toISOString();
    }
    return order;
  }

  public getOrdersByOrganization(organizationId: string): Order[] {
    return this.ordersStore.filter(o => o.organizationId === organizationId);
  }
}
