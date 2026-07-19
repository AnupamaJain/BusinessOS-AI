import { describe, it, expect } from 'vitest';
import {
  checkHandoffRequired,
  checkOptOut,
  checkGrounding,
  checkNoMedicalClaims,
  checkNoInternalLeakage,
  classifyIntent,
  evaluatePolicy,
} from '../policy';
import { createInitialState } from '../state';

describe('Policy Engine Rules', () => {
  describe('checkHandoffRequired', () => {
    it('requires handoff on complaint or refund intent', () => {
      expect(checkHandoffRequired('complaint_or_refund', 'normal message')).toBe(true);
    });

    it('requires handoff on human request intent', () => {
      expect(checkHandoffRequired('human_request', 'normal message')).toBe(true);
    });

    it('requires handoff on medical keywords', () => {
      expect(checkHandoffRequired('unknown', 'I need a treatment for eczema')).toBe(true);
    });

    it('does not require handoff for generic messages', () => {
      expect(checkHandoffRequired('sales_enquiry', 'recommend a sunscreen')).toBe(false);
    });
  });

  describe('checkOptOut', () => {
    it('detects opt_out intent', () => {
      expect(checkOptOut('opt_out', 'anything')).toBe(true);
    });

    it('detects opt-out keywords', () => {
      expect(checkOptOut('unknown', 'please stop sending messages')).toBe(true);
      expect(checkOptOut('unknown', 'unsubscribe me')).toBe(true);
    });
  });

  describe('checkGrounding', () => {
    it('succeeds if a source is above confidence threshold', () => {
      const sources = [
        { documentId: 'doc1', chunkId: 'chk1', content: 'test', score: 0.8 },
      ];
      expect(checkGrounding(sources)).toBe(true);
    });

    it('fails if all sources are below confidence threshold', () => {
      const sources = [
        { documentId: 'doc1', chunkId: 'chk1', content: 'test', score: 0.005 },
      ];
      expect(checkGrounding(sources)).toBe(false);
    });

    it('fails if no sources are provided', () => {
      expect(checkGrounding([])).toBe(false);
    });
  });

  describe('checkNoMedicalClaims', () => {
    it('succeeds for safe skincare responses', () => {
      expect(checkNoMedicalClaims('This sunscreen is matte and non-greasy')).toBe(true);
    });

    it('fails for medical claims', () => {
      expect(checkNoMedicalClaims('This serum will cure eczema')).toBe(false);
    });
  });

  describe('checkNoInternalLeakage', () => {
    it('succeeds for customer-facing responses', () => {
      expect(checkNoInternalLeakage('Our returns policy allows 15 days.')).toBe(true);
    });

    it('fails if exposing database query or system prompt details', () => {
      expect(checkNoInternalLeakage('Here is the SQL query used to search.')).toBe(false);
    });
  });

  describe('classifyIntent', () => {
    it('correctly classifies sales enquiry', () => {
      expect(classifyIntent('I want to buy a sunscreen')).toBe('sales_enquiry');
    });

    it('correctly classifies refund', () => {
      expect(classifyIntent('connect me to a person for refund')).toBe('complaint_or_refund');
    });

    it('correctly classifies human request', () => {
      expect(classifyIntent('speak to a human agent please')).toBe('human_request');
    });

    it('correctly classifies opt-out', () => {
      expect(classifyIntent('stop')).toBe('opt_out');
    });

    it('falls back to unknown', () => {
      expect(classifyIntent('random words')).toBe('unknown');
    });
  });

  describe('evaluatePolicy', () => {
    const defaultParams = {
      organizationId: '11111111-1111-1111-1111-111111111111',
      contactId: '33333333-3333-3333-3333-333333333333',
      conversationId: '55555555-5555-5555-5555-555555555555',
      inboundMessage: 'Hello',
      traceId: 'trace-123',
    };

    it('passes for generic enquiry', () => {
      const state = createInitialState(defaultParams);
      state.intent = 'sales_enquiry';
      const decision = evaluatePolicy(state);
      expect(decision.allowed).toBe(true);
      expect(decision.shouldHandoff).toBe(false);
    });

    it('triggers handoff for complaint', () => {
      const state = createInitialState(defaultParams);
      state.intent = 'complaint_or_refund';
      state.inboundMessage = 'I want a refund';
      const decision = evaluatePolicy(state);
      expect(decision.allowed).toBe(false);
      expect(decision.shouldHandoff).toBe(true);
      expect(decision.reason).toBe('handoff_required');
    });

    it('triggers handoff on medical keywords', () => {
      const state = createInitialState(defaultParams);
      state.intent = 'support_question';
      state.inboundMessage = 'Can you diagnose my skin disease?';
      const decision = evaluatePolicy(state);
      expect(decision.allowed).toBe(false);
      expect(decision.shouldHandoff).toBe(true);
    });
  });
});
