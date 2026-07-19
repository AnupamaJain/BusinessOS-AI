import type { PaymentLink, PaymentProvider } from './types';
import { randomUUID } from 'crypto';

export class PaymentService {
  private paymentLinksStore: PaymentLink[] = [];

  public createPaymentLink(params: {
    organizationId: string;
    orderId: string;
    amount: number;
    currency?: string;
    provider?: PaymentProvider;
  }): PaymentLink {
    const paymentNumber = `PAY-${Math.floor(100000 + Math.random() * 900000)}`;
    const provider = params.provider ?? 'razorpay';
    const currency = params.currency ?? 'INR';
    const paymentLinkUrl = `https://pay.businessos.ai/checkout/${paymentNumber}?org=${params.organizationId}`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 mins

    const paymentLink: PaymentLink = {
      id: randomUUID(),
      organizationId: params.organizationId,
      orderId: params.orderId,
      paymentNumber,
      provider,
      amount: params.amount,
      currency,
      status: 'pending',
      paymentLinkUrl,
      expiresAt
    };

    this.paymentLinksStore.push(paymentLink);
    return paymentLink;
  }

  public verifyPayment(paymentNumber: string): PaymentLink | undefined {
    const link = this.paymentLinksStore.find(p => p.paymentNumber === paymentNumber);
    if (link) {
      link.status = 'captured';
    }
    return link;
  }
}
