import type { Product } from './types';
import { randomUUID } from 'crypto';

export class CatalogService {
  private productsStore: Product[] = [];

  public createProduct(params: {
    organizationId: string;
    sku: string;
    name: string;
    description?: string;
    category?: string;
    basePrice: number;
    currency?: string;
  }): Product {
    const existing = this.productsStore.find(
      p => p.organizationId === params.organizationId && p.sku === params.sku
    );

    if (existing) {
      return existing;
    }

    const product: Product = {
      id: randomUUID(),
      organizationId: params.organizationId,
      sku: params.sku,
      name: params.name,
      description: params.description,
      category: params.category,
      basePrice: params.basePrice,
      currency: params.currency ?? 'INR',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.productsStore.push(product);
    return product;
  }

  public searchProducts(organizationId: string, query?: string): Product[] {
    let list = this.productsStore.filter(p => p.organizationId === organizationId && p.status === 'active');
    if (query) {
      const q = query.toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
    }
    return list;
  }
}
