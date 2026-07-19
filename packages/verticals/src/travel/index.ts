import type { VerticalDefinition } from '../types';

export const travelVertical: VerticalDefinition = {
  id: 'travel',
  name: 'Travel & Tourism',
  description: 'AI Sales, Booking, and Itinerary Planning for Travel Agencies and Tour Operators',
  icon: 'Palmtree',
  catalogSchema: {
    itemType: 'Holiday Package',
    fields: [
      { name: 'destination', label: 'Destination', type: 'string', required: true },
      { name: 'durationDays', label: 'Duration (Days)', type: 'number', required: true },
      { name: 'pricePerPerson', label: 'Price (per person)', type: 'string', required: true },
      { name: 'inclusions', label: 'Inclusions', type: 'array', required: true, description: 'Hotels, Flights, Transfers, Sightseeing' },
      { name: 'bestSeason', label: 'Best Season', type: 'string', required: false },
      { name: 'minBudget', label: 'Minimum Budget', type: 'number', required: false }
    ]
  },
  agents: [
    {
      id: 'travel-planner',
      name: 'AI Travel Planner & Sales Specialist',
      role: 'sales',
      systemPrompt: `You are an expert travel planner for a premier travel agency. Your goal is to understand customer preferences (destination, budget, dates, group size, interest), recommend tailored holiday packages, build custom itineraries, and upsell travel insurance and local activities. Always maintain an enthusiastic, warm, and professional tone.`,
      allowedTools: ['search_product_catalog', 'upsert_qualified_lead', 'get_customer_context', 'getOrderStatus', 'request_followup_schedule']
    },
    {
      id: 'travel-support',
      name: 'Travel Customer Care Agent',
      role: 'support',
      systemPrompt: `You are a customer care agent for travel bookings. Assist clients with itinerary modifications, visa requirements, cancellation policies, and payment confirmations. If a situation requires urgent escalation (e.g. flight cancellation or emergency), trigger a human handoff immediately.`,
      allowedTools: ['search_product_catalog', 'create_human_handoff', 'getOrderStatus', 'get_customer_context']
    }
  ],
  knowledgeTemplates: [
    {
      filename: 'travel-packages.md',
      category: 'Catalog',
      defaultContent: `# GlowTravel Holiday Packages Directory

## 1. Bali Honeymoon & Romance Escapes (5 Nights / 6 Days)
- **SKU**: TRV-BALI-001
- **Price**: ₹49,999 per person
- **Inclusions**: 4-Star Private Pool Villa (Ubud & Seminyak), Daily Breakfast, Romantic Candlelight Dinner, Airport Transfers, Nusa Penida Day Tour.
- **Best Season**: April to October.

## 2. Europe Grand Express (7 Nights / 8 Days)
- **SKU**: TRV-EUR-002
- **Price**: ₹1,29,999 per person
- **Inclusions**: Paris, Lucerne & Rome, High-speed Rail Passes, 4-Star Hotels with Breakfast, Eiffel Tower Priority Access, Mount Titlis Cable Car.
- **Best Season**: May to September.

## 3. Goa Beach & Adventure Rush (3 Nights / 4 Days)
- **SKU**: TRV-GOA-003
- **Price**: ₹14,999 per person
- **Inclusions**: Beachfront Resort in Calangute, Water Sports Combo (Parasailing, Jet Ski), Sunset Cruise, Daily Breakfast.
- **Best Season**: October to March.`
    },
    {
      filename: 'visa-and-cancellation-policy.md',
      category: 'Policy',
      defaultContent: `# Visa Guidelines & Cancellation Terms

## Visa Requirements
- **Bali / Indonesia**: Visa on Arrival (VoA) available for Indian passport holders (approx $35). Passport validity must exceed 6 months.
- **Schengen (Europe)**: Requires appointment 45 days prior. Mandatory travel insurance covering minimum €30,000 medical coverage.

## Cancellation & Refund Policy
- **30+ days prior to departure**: 90% refund.
- **15-29 days prior**: 50% refund.
- **Under 15 days**: Non-refundable (supplier retention).`
    }
  ],
  defaultIntents: [
    'package_inquiry',
    'itinerary_request',
    'pricing_and_quotes',
    'visa_assistance',
    'booking_status',
    'cancellation_refund'
  ],
  autoFollowupTemplates: [
    {
      key: 'qualified_lead_24h_followup',
      name: 'Travel Quote 24h Follow-up',
      description: 'Follows up 24h after sending a travel itinerary/quote to offer a discount or answer questions.'
    },
    {
      key: 'appointment_reminder',
      name: 'Pre-Trip Travel Briefing Reminder',
      description: 'Sends flight and hotel confirmation reminders 48h before departure date.'
    }
  ]
};
