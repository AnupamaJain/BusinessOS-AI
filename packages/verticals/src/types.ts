
export interface CatalogItemField {
  name: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'array';
  required: boolean;
  description?: string;
}

export interface VerticalCatalogSchema {
  itemType: string;
  fields: CatalogItemField[];
}

export interface VerticalAgentConfig {
  id: string;
  name: string;
  role: 'sales' | 'support' | 'booking' | 'payment' | 'custom';
  systemPrompt: string;
  allowedTools: string[];
}

export interface KnowledgeTemplate {
  filename: string;
  category: string;
  defaultContent: string;
}

export interface VerticalDefinition {
  id: string;
  name: string;
  description: string;
  icon: string;
  catalogSchema: VerticalCatalogSchema;
  agents: VerticalAgentConfig[];
  knowledgeTemplates: KnowledgeTemplate[];
  defaultIntents: string[];
  autoFollowupTemplates: Array<{
    key: string;
    name: string;
    description: string;
  }>;
}
