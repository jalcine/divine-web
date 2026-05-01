// ABOUTME: Singleton service for tracking WebSocket relay health metrics
// ABOUTME: Tracks connection state, latency, success/failure rates, event counts
// ABOUTME: Data is flushed to Sentry on page unload for production monitoring

type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

interface RelayMetricsData {
  relayUrl: string;
  connectionState: ConnectionState;
  latencyMs: number | null;
  totalQueries: number;
  successfulQueries: number;
  failedQueries: number;
  totalEvents: number;
  lastConnectedAt: number | null;
  lastErrorAt: number | null;
}

class RelayMetrics {
  private metrics = new Map<string, RelayMetricsData>();

  setState(relayUrl: string, state: ConnectionState) {
    const existing = this.metrics.get(relayUrl) || this.createEmpty(relayUrl);
    if (state === 'connected' && existing.connectionState !== 'connected') {
      existing.lastConnectedAt = Date.now();
    }
    if (state === 'error') {
      existing.lastErrorAt = Date.now();
    }
    existing.connectionState = state;
    this.metrics.set(relayUrl, existing);
  }

  recordLatency(relayUrl: string, latencyMs: number) {
    const existing = this.metrics.get(relayUrl) || this.createEmpty(relayUrl);
    existing.latencyMs = latencyMs;
    existing.totalQueries++;
    existing.successfulQueries++;
    this.metrics.set(relayUrl, existing);
  }

  recordFailure(relayUrl: string) {
    const existing = this.metrics.get(relayUrl) || this.createEmpty(relayUrl);
    existing.totalQueries++;
    existing.failedQueries++;
    existing.lastErrorAt = Date.now();
    this.metrics.set(relayUrl, existing);
  }

  recordEventCount(relayUrl: string, count: number) {
    const existing = this.metrics.get(relayUrl) || this.createEmpty(relayUrl);
    existing.totalEvents += count;
    this.metrics.set(relayUrl, existing);
  }

  getMetrics(relayUrl: string): RelayMetricsData | undefined {
    return this.metrics.get(relayUrl);
  }

  getAllMetrics(): Map<string, RelayMetricsData> {
    return new Map(this.metrics);
  }

  flushToSentry(): void {
    if (typeof window === 'undefined') return;
    const { captureNonFatalError } = require('./sentry');
    const summary = this.getSummary();
    const allMetrics = Object.fromEntries(this.metrics);
    captureNonFatalError(
      new Error('RelayMetrics summary'),
      { relayMetrics: { summary, relays: allMetrics } }
    );
  }

  getSummary() {
    let totalQueries = 0, totalSuccessful = 0, totalFailed = 0, totalEvents = 0, connectedCount = 0;
    for (const m of this.metrics.values()) {
      totalQueries += m.totalQueries;
      totalSuccessful += m.successfulQueries;
      totalFailed += m.failedQueries;
      totalEvents += m.totalEvents;
      if (m.connectionState === 'connected') connectedCount++;
    }
    return { relayCount: this.metrics.size, connectedCount, totalQueries, successRate: totalQueries > 0 ? totalSuccessful / totalQueries : 0, totalEvents };
  }

  private createEmpty(relayUrl: string): RelayMetricsData {
    return { relayUrl, connectionState: 'disconnected', latencyMs: null, totalQueries: 0, successfulQueries: 0, failedQueries: 0, totalEvents: 0, lastConnectedAt: null, lastErrorAt: null };
  }
}

export const relayMetrics = new RelayMetrics();
