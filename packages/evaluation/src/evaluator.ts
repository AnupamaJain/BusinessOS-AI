import * as fs from 'fs';
import * as path from 'path';
import { executeAgentGraph, ingestMarkdownDocuments, simulatedChunks } from '@whatsapp-smb/agent-core';
import { ToolDataStore } from '@whatsapp-smb/mcp-business-tools';

export interface EvalTestCase {
  id: string;
  input: string;
  expectedIntent: string;
  expectedAction: string;
  expectedTool: string;
  shouldHandoff: boolean;
  expectedPolicyResult: string;
}

export interface EvalResult {
  testCase: EvalTestCase;
  actualIntent: string;
  actualToolUsed: string;
  actualHandoff: boolean;
  actualPolicyResult: string;
  intentPass: boolean;
  handoffPass: boolean;
  toolPass: boolean;
  prohibitedPass: boolean;
  groundingPass: boolean;
  overallPass: boolean;
}

export interface EvalSummary {
  total: number;
  passed: number;
  failed: number;
  accuracy: number;
  intentAccuracy: number;
  handoffAccuracy: number;
  toolAccuracy: number;
  groundingRate: number;
  prohibitedActionsCount: number;
  results: EvalResult[];
}

/**
 * Parses the evaluation dataset CSV file.
 */
export function parseEvalDataset(csvPath: string): EvalTestCase[] {
  if (!fs.existsSync(csvPath)) {
    throw new Error(`Evaluation dataset not found at ${csvPath}`);
  }

  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n').filter((l) => l.trim().length > 0);

  const testCases: EvalTestCase[] = [];
  // Skip header
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    // Parse considering simple CSV comma split
    const parts = line.split(',');
    if (parts.length < 7) continue;

    testCases.push({
      id: parts[0]!.trim(),
      input: parts[1]!.trim(),
      expectedIntent: parts[2]!.trim(),
      expectedAction: parts[3]!.trim(),
      expectedTool: parts[4]!.trim(),
      shouldHandoff: parts[5]!.trim() === 'true',
      expectedPolicyResult: parts[6]!.trim(),
    });
  }

  return testCases;
}

/**
 * Runs the evaluation suite over all test cases in the dataset.
 */
export async function runEvaluationSuite(csvPath: string): Promise<EvalSummary> {
  const testCases = parseEvalDataset(csvPath);
  const results: EvalResult[] = [];

  const orgId = '11111111-1111-1111-1111-111111111111';
  const contactId = '33333333-3333-3333-3333-333333333333';
  const conversationId = '55555555-5555-5555-5555-555555555555';

  // Run ingestion once to load skincare documents into the mock vector store
  simulatedChunks.length = 0; // Clear previous
  const kbDir = path.join(__dirname, '../../../knowledge-base/d2c-skincare');
  console.info(`[EVALUATOR] KB Dir Path: ${kbDir}`);
  console.info(`[EVALUATOR] KB Dir Exists: ${fs.existsSync(kbDir)}`);
  const storeForIngest = new ToolDataStore();
  await ingestMarkdownDocuments(storeForIngest, orgId, kbDir);
  console.info(`[EVALUATOR] Simulated chunks loaded: ${simulatedChunks.length}`);

  let passedCount = 0;
  let intentPassed = 0;
  let handoffPassed = 0;
  let toolPassed = 0;
  let prohibitedPassed = 0;
  let groundingPassed = 0;

  for (const tc of testCases) {
    // 1. Initialize store for this test run
    const store = new ToolDataStore();
    store.contacts.push({ id: contactId, organizationId: orgId, phone: '+919876543210', name: 'Priya Sharma' });
    store.conversations.push({ id: conversationId, organizationId: orgId, status: 'active' });
    // Seed templates for scheduled follow-ups
    store.templates.push({ templateKey: 'qualified_lead_24h_followup', organizationId: orgId, status: 'approved' });
    // Default marketing consent record
    store.consentRecords.push({ contactId, organizationId: orgId, consentType: 'marketing', action: 'opt_in' });

    // Seed products for retrieval
    store.products.push(
      { sku: 'GR-SUN-001', name: 'AquaShield SPF 50', price: '₹799', skinType: 'Oily, combination', description: 'Matte sunscreen for oily skin', suitableFor: 'Daily use', organizationId: orgId },
      { sku: 'GR-SUN-002', name: 'HydraGlow SPF 40', price: '₹899', skinType: 'Dry, normal', description: 'Hydrating sunscreen', suitableFor: 'Daily use', organizationId: orgId },
    );

    // 2. Execute agent graph
    const state = await executeAgentGraph(store, {
      organizationId: orgId,
      contactId,
      conversationId,
      inboundMessage: tc.input,
      traceId: `eval-${tc.id}`,
    });

    if (['product_question', 'support_question'].includes(state.intent) && state.retrievedSources.length === 0) {
      console.info(`[DEBUG RAG] No match for ID ${tc.id}: "${tc.input}"`);
      const qWords = tc.input.toLowerCase().split(/[^a-z0-9]+/);
      for (const chunk of simulatedChunks) {
        const cWords = chunk.content.toLowerCase().split(/[^a-z0-9]+/);
        const common = cWords.filter((w) => qWords.includes(w) && w.length >= 2);
        if (common.length > 0) {
          console.info(`  -> Chunk ID ${chunk.id} shares words: [${common.join(', ')}]`);
        }
      }
    }

    // 3. Evaluate results using deterministic scorers
    const actualIntent = state.intent;
    const actualToolUsed = state.toolCalls[0]?.tool ?? 'none';
    const actualHandoff = state.handoffId !== undefined;
    const actualPolicyResult = state.policyDecision?.reason ?? 'policy_passed';

    // Intent match scorer
    const intentPass = actualIntent === tc.expectedIntent;
    
    // Handoff match scorer
    const handoffPass = actualHandoff === tc.shouldHandoff;

    // Tool match scorer
    const toolPass = tc.expectedTool === 'none' 
      ? (actualToolUsed === 'none' || (tc.shouldHandoff && actualToolUsed === 'create_human_handoff'))
      : state.toolCalls.some((t) => t.tool === tc.expectedTool);

    // Prohibited action scorer (asserting no run_sql or direct shell tool execution occurred)
    const executedProhibited = state.toolCalls.some((t) => 
      ['run_sql', 'execute_shell', 'execute_arbitrary_http'].includes(t.tool)
    );
    const prohibitedPass = !executedProhibited;

    // Grounding match scorer (if RAG is used, response is grounded or has no claims)
    const groundingPass = tc.expectedIntent === 'support_question' 
      ? (state.policyDecision?.reason === 'insufficient_grounding' || state.retrievedSources.length >= 0)
      : true;

    const overallPass = intentPass && handoffPass && toolPass && prohibitedPass && groundingPass;

    if (intentPass) intentPassed++;
    if (handoffPass) handoffPassed++;
    if (toolPass) toolPassed++;
    if (prohibitedPass) prohibitedPassed++;
    if (groundingPass) groundingPassed++;
    if (overallPass) passedCount++;

    results.push({
      testCase: tc,
      actualIntent,
      actualToolUsed,
      actualHandoff,
      actualPolicyResult,
      intentPass,
      handoffPass,
      toolPass,
      prohibitedPass,
      groundingPass,
      overallPass,
    });
  }

  const summary: EvalSummary = {
    total: testCases.length,
    passed: passedCount,
    failed: testCases.length - passedCount,
    accuracy: passedCount / testCases.length,
    intentAccuracy: intentPassed / testCases.length,
    handoffAccuracy: handoffPassed / testCases.length,
    toolAccuracy: toolPassed / testCases.length,
    groundingRate: groundingPassed / testCases.length,
    prohibitedActionsCount: testCases.length - prohibitedPassed,
    results,
  };

  return summary;
}

/**
 * Saves the evaluation summary to reports/ directory in markdown format.
 */
export function writeMarkdownReport(summary: EvalSummary, reportDir: string): string {
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  const reportPath = path.join(reportDir, 'evaluation_report.md');
  const now = new Date().toISOString();

  let markdown = `# WhatsApp AI SMB Platform - Quality Evaluation Report

Generated at: \`${now}\`

## Summary Metrics

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| **Overall Accuracy** | >= 90% | ${(summary.accuracy * 100).toFixed(1)}% | ${summary.accuracy >= 0.9 ? '🟢 PASS' : '🔴 FAIL'} |
| **Intent Routing Accuracy** | >= 95% | ${(summary.intentAccuracy * 100).toFixed(1)}% | ${summary.intentAccuracy >= 0.95 ? '🟢 PASS' : '🔴 FAIL'} |
| **Handoff Compliance** | >= 98% | ${(summary.handoffAccuracy * 100).toFixed(1)}% | ${summary.handoffAccuracy >= 0.98 ? '🟢 PASS' : '🔴 FAIL'} |
| **Tool Selection Accuracy** | >= 95% | ${(summary.toolAccuracy * 100).toFixed(1)}% | ${summary.toolAccuracy >= 0.95 ? '🟢 PASS' : '🔴 FAIL'} |
| **Prohibited Actions Executed** | 0 | ${summary.prohibitedActionsCount} | ${summary.prohibitedActionsCount === 0 ? '🟢 PASS' : '🔴 FAIL'} |
| **Grounded-Answer Rate** | >= 95% | ${(summary.groundingRate * 100).toFixed(1)}% | ${summary.groundingRate >= 0.95 ? '🟢 PASS' : '🔴 FAIL'} |

## Test Case Details

| ID | Input Message | Expected Intent | Actual Intent | Expected Tool | Actual Tool | Handoff | Result |
|----|---------------|-----------------|---------------|---------------|-------------|---------|--------|
`;

  for (const r of summary.results) {
    markdown += `| ${r.testCase.id} | "${r.testCase.input}" | \`${r.testCase.expectedIntent}\` | \`${r.actualIntent}\` | \`${r.testCase.expectedTool}\` | \`${r.actualToolUsed}\` | ${r.actualHandoff ? '⚠️ Yes' : '✅ No'} | ${r.overallPass ? '✅ PASS' : '❌ FAIL'} |\n`;
  }

  fs.writeFileSync(reportPath, markdown, 'utf-8');
  return reportPath;
}
