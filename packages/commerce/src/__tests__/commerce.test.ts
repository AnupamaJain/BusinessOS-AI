import { describe, it, expect, beforeEach } from 'vitest';
import { CatalogService, OrderService, PaymentService } from '../index';

const ORG_A = '11111111-1111-1111-1111-111111111111';
const CONTACT_A = '22222222-2222-2222-2222-222222222222';

describe('Commerce Package', () => {
  let catalogService: CatalogService;
  let orderService: OrderService;
  let paymentService: PaymentService;

  beforeEach(() => {
    catalogService = new CatalogService();
    orderService = new OrderService();
    paymentService = new PaymentService();
  });

  it('creates and searches catalog products', () => {
    const p1 = catalogService.createProduct({
      organizationId: ORG_A,
      sku: 'TRV-BALI-001',
      name: 'Bali Honeymoon & Romance Escapes',
      basePrice: 49999,
      category: 'Holiday Package'
    });

    expect(p1.id).toBeDefined();
    expect(p1.sku).toBe('TRV-BALI-001');

    const results = catalogService.searchProducts(ORG_A, 'Bali');
    expect(results.length).toBe(1);
    expect(results[0]?.name).toContain('Bali');
  });

  it('creates orders and calculates totals correctly', () => {
    const p1 = catalogService.createProduct({
      organizationId: ORG_A,
      sku: 'TRV-BALI-001',
      name: 'Bali Package',
      basePrice: 49999
    });

    const order = orderService.createOrder({
      organizationId: ORG_A,
      contactId: CONTACT_A,
      items: [{ productId: p1.id, title: p1.name, unitPrice: 49999, quantity: 2 }],
      discountAmount: 5000,
      taxAmount: 4500
    });

    expect(order.orderNumber).toContain('ORD-');
    expect(order.subtotal).toBe(99998);
    expect(order.totalAmount).toBe(99498);
    expect(order.status).toBe('created');

    const updated = orderService.updateOrderStatus(order.id, 'paid');
    expect(updated?.status).toBe('paid');
  });

  it('generates and verifies payment links', () => {
    const paymentLink = paymentService.createPaymentLink({
      organizationId: ORG_A,
      orderId: 'ord-123',
      amount: 99498,
      provider: 'razorpay'
    });

    expect(paymentLink.paymentNumber).toContain('PAY-');
    expect(paymentLink.paymentLinkUrl).toContain('pay.businessos.ai');
    expect(paymentLink.status).toBe('pending');

    const verified = paymentService.verifyPayment(paymentLink.paymentNumber);
    expect(verified?.status).toBe('captured');
  });
});
