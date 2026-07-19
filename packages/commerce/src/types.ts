import { z } from 'zod';

export type OrderStatus = 'created' | 'pending_payment' | 'paid' | 'fulfilled' | 'cancelled' | 'refunded';
export type PaymentProvider = 'razorpay' | 'stripe' | 'upi' | 'cash';
export type PaymentStatus = 'pending' | 'authorized' | 'captured' | 'failed' | 'refunded';

export interface Product {
  id: string;
  organizationId: string;
  sku: string;
  name: string;
  description?: string;
  category?: string;
  basePrice: number;
  currency: string;
  status: 'active' | 'draft' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export interface OrderItem {
  productId: string;
  title: string;
  unitPrice: number;
  quantity: number;
  totalPrice: number;
}

export interface Order {
  id: string;
  organizationId: string;
  contactId: string;
  orderNumber: string;
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  totalAmount: number;
  currency: string;
  status: OrderStatus;
  items: OrderItem[];
  createdAt: string;
  updatedAt: string;
}

export interface PaymentLink {
  id: string;
  organizationId: string;
  orderId: string;
  paymentNumber: string;
  provider: PaymentProvider;
  amount: number;
  currency: string;
  status: PaymentStatus;
  paymentLinkUrl: string;
  expiresAt: string;
}

export const CreateOrderInputSchema = z.object({
  organizationId: z.string().uuid(),
  contactId: z.string().uuid(),
  items: z.array(z.object({
    productId: z.string(),
    title: z.string(),
    unitPrice: z.number().min(0),
    quantity: z.number().min(1)
  })).min(1),
  discountAmount: z.number().min(0).default(0),
  taxAmount: z.number().min(0).default(0),
  currency: z.string().default('INR'),
  idempotencyKey: z.string()
});
