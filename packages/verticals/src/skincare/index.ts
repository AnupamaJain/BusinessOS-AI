import type { VerticalDefinition } from '../types';

export const skincareVertical: VerticalDefinition = {
  id: 'd2c-skincare',
  name: 'D2C Skincare & Personal Care',
  description: 'Product advice, ingredients matching, returns policy, and lead qualification for skincare brands',
  icon: 'Sparkles',
  catalogSchema: {
    itemType: 'Skincare Product',
    fields: [
      { name: 'sku', label: 'SKU Code', type: 'string', required: true },
      { name: 'skinType', label: 'Suitable Skin Types', type: 'string', required: true },
      { name: 'price', label: 'Price', type: 'string', required: true },
      { name: 'suitableFor', label: 'Target Skin Concern', type: 'string', required: true }
    ]
  },
  agents: [
    {
      id: 'skincare-advisor',
      name: 'Skincare Product Specialist',
      role: 'sales',
      systemPrompt: 'You are a friendly skincare specialist. Help customers find products suited for their skin type and concern.',
      allowedTools: ['search_product_catalog', 'upsert_qualified_lead', 'get_customer_context']
    }
  ],
  knowledgeTemplates: [
    {
      filename: 'products.md',
      category: 'Catalog',
      defaultContent: '# GlowRoot Products Catalog'
    }
  ],
  defaultIntents: [
    'product_inquiry',
    'recommendation_request',
    'order_status',
    'medical_claims_detected',
    'complaint_or_refund'
  ],
  autoFollowupTemplates: [
    {
      key: 'qualified_lead_24h_followup',
      name: 'Skincare Regimen 24h Follow-up',
      description: 'Check in on product recommendations after 24 hours.'
    }
  ]
};
