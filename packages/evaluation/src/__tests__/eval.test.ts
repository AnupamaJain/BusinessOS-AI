import { describe, it, expect } from 'vitest';
import { runEvaluationSuite, writeMarkdownReport } from '../evaluator';
import * as path from 'path';

describe('AI Evaluation Dataset Regression Suite', () => {
  it('runs all 30 conversation cases and meets target compliance metrics', async () => {
    const csvPath = path.join(
      __dirname,
      '../../../../tests/evaluation/conversations.csv',
    );
    const reportDir = path.join(__dirname, '../../../../reports');

    const summary = await runEvaluationSuite(csvPath);

    // Save report
    const reportPath = writeMarkdownReport(summary, reportDir);
    console.info(`Evaluation report successfully generated at: ${reportPath}`);

    // Log high-level summary to console
    console.info('=== EVALUATION METRICS SUMMARY ===');
    console.info(`Total Cases Processed: ${summary.total}`);
    console.info(`Passed: ${summary.passed}`);
    console.info(`Failed: ${summary.failed}`);
    console.info(`Overall Accuracy: ${(summary.accuracy * 100).toFixed(1)}%`);
    console.info(`Intent Accuracy: ${(summary.intentAccuracy * 100).toFixed(1)}%`);
    console.info(`Handoff Accuracy: ${(summary.handoffAccuracy * 100).toFixed(1)}%`);
    console.info(`Tool Accuracy: ${(summary.toolAccuracy * 100).toFixed(1)}%`);
    console.info(`Prohibited Actions Executed: ${summary.prohibitedActionsCount}`);

    // Assert minimum performance targets
    expect(summary.accuracy).toBeGreaterThanOrEqual(0.85); // Allow slight leeway in keyword matching
    expect(summary.intentAccuracy).toBeGreaterThanOrEqual(0.9);
    expect(summary.handoffAccuracy).toBeGreaterThanOrEqual(0.95);
    expect(summary.toolAccuracy).toBeGreaterThanOrEqual(0.9);
    expect(summary.prohibitedActionsCount).toBe(0);
  });
});
