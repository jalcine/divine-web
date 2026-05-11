// NIP-56 compliance tests for useReportContent hook

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ContentFilterReason } from '@/types/moderation';

// We test the non-exported mapReasonToNip56 by testing observable behavior
// The function is module-private, so we test it indirectly through useReportContent

const mockPublishEvent = vi.fn();
const mockUserPubkey = 'aabbccdd11223344aabbccdd11223344aabbccdd11223344aabbccdd11223344';

vi.mock('@/hooks/useNostrPublish', () => ({
  useNostrPublish: () => ({
    mutate: mockPublishEvent,
    mutateAsync: mockPublishEvent,
  }),
}));

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({
    user: { pubkey: mockUserPubkey },
  }),
}));

vi.mock('@/lib/reportApi', () => ({
  submitReportToZendesk: vi.fn().mockResolvedValue(undefined),
  buildContentUrl: vi.fn().mockReturnValue('https://divine.video/e/test'),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useReportContent NIP-56 compliance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
  });

  describe('mapReasonToNip56', () => {
    // NIP-56 compliance: e/p tag 3rd element must use standard types, NOT app-level reasons
    // @see https://github.com/nostr-protocol/nips/blob/master/56.md
    it.each([
      { reason: ContentFilterReason.SPAM, expected: 'spam' },
      { reason: ContentFilterReason.HARASSMENT, expected: 'profanity' },
      { reason: ContentFilterReason.VIOLENCE, expected: 'illegal' },
      { reason: ContentFilterReason.SEXUAL_CONTENT, expected: 'nudity' },
      { reason: ContentFilterReason.COPYRIGHT, expected: 'other' },
      { reason: ContentFilterReason.FALSE_INFO, expected: 'other' },
      { reason: ContentFilterReason.CSAM, expected: 'illegal' },
      { reason: ContentFilterReason.AI_GENERATED, expected: 'other' },
      { reason: ContentFilterReason.IMPERSONATION, expected: 'impersonation' },
      { reason: ContentFilterReason.ILLEGAL, expected: 'illegal' },
      { reason: ContentFilterReason.OTHER, expected: 'other' },
    ])('maps $reason to NIP-56 type $expected', async ({ reason, expected }) => {
      const { useReportContent } = await import('@/hooks/useModeration');

      const { result } = renderHook(() => useReportContent(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.mutateAsync({
          eventId: 'test-event-id',
          reason,
        });
      });

      expect(mockPublishEvent).toHaveBeenCalledTimes(1);
      const publishedEvent = mockPublishEvent.mock.calls[0][0];

      // e tag should use NIP-56 mapped value
      const eTag = publishedEvent.tags.find((tag: string[]) => tag[0] === 'e');
      expect(eTag).toBeDefined();
      expect(eTag[2]).toBe(expected);

      // l tag should keep original app reason (NIP-32 for specificity)
      const lTag = publishedEvent.tags.find((tag: string[]) => tag[0] === 'l');
      expect(lTag).toBeDefined();
      expect(lTag[1]).toBe(`NS-${reason}`);
    });

    it('p tag also uses NIP-56 mapped value', async () => {
      const { useReportContent } = await import('@/hooks/useModeration');

      const { result } = renderHook(() => useReportContent(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.mutateAsync({
          pubkey: 'test-pubkey',
          reason: ContentFilterReason.SEXUAL_CONTENT,
        });
      });

      expect(mockPublishEvent).toHaveBeenCalledTimes(1);
      const publishedEvent = mockPublishEvent.mock.calls[0][0];

      // p tag should use NIP-56 mapped value (nudity, not sexual-content)
      const pTag = publishedEvent.tags.find((tag: string[]) => tag[0] === 'p');
      expect(pTag).toBeDefined();
      expect(pTag[2]).toBe('nudity');
    });

    it('L tag is always social.nos.ontology (NIP-32 namespace)', async () => {
      const { useReportContent } = await import('@/hooks/useModeration');

      const { result } = renderHook(() => useReportContent(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.mutateAsync({
          eventId: 'test-event-id',
          reason: ContentFilterReason.SPAM,
        });
      });

      expect(mockPublishEvent).toHaveBeenCalledTimes(1);
      const publishedEvent = mockPublishEvent.mock.calls[0][0];

      // L tag should always be the NIP-32 namespace
      const LTag = publishedEvent.tags.find((tag: string[]) => tag[0] === 'L');
      expect(LTag).toBeDefined();
      expect(LTag[1]).toBe('social.nos.ontology');
    });

    it('report with both eventId and pubkey uses NIP-56 for both e and p tags', async () => {
      const { useReportContent } = await import('@/hooks/useModeration');

      const { result } = renderHook(() => useReportContent(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.mutateAsync({
          eventId: 'test-event-id',
          pubkey: 'test-pubkey',
          reason: ContentFilterReason.HARASSMENT,
        });
      });

      expect(mockPublishEvent).toHaveBeenCalledTimes(1);
      const publishedEvent = mockPublishEvent.mock.calls[0][0];

      // Both e and p tags should use NIP-56 mapped value (profanity, not harassment)
      const eTag = publishedEvent.tags.find((tag: string[]) => tag[0] === 'e');
      const pTag = publishedEvent.tags.find((tag: string[]) => tag[0] === 'p');

      expect(eTag[2]).toBe('profanity');
      expect(pTag[2]).toBe('profanity');

      // l tag should keep original reason
      const lTags = publishedEvent.tags.filter((tag: string[]) => tag[0] === 'l');
      expect(lTags).toHaveLength(1);
      expect(lTags[0][1]).toBe('NS-harassment');
    });
  });
});
