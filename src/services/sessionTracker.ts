import {
  type CCUsageBlock,
  type SessionInfo,
  type SessionTracking,
  SessionWindow,
} from '../types/usage';

export class SessionTracker {
  private static instance: SessionTracker;
  private readonly WINDOW_DURATION = 5 * 60 * 60 * 1000; // 5 hours in milliseconds
  private readonly SESSION_GAP_THRESHOLD = 10 * 60 * 1000; // 10 minutes gap threshold

  private sessionTracking: SessionTracking;

  constructor() {
    this.sessionTracking = this.initializeSessionTracking();
  }

  static getInstance(): SessionTracker {
    if (!SessionTracker.instance) {
      SessionTracker.instance = new SessionTracker();
    }
    return SessionTracker.instance;
  }

  private initializeSessionTracking(): SessionTracking {
    const now = new Date();
    const windowStart = new Date(now.getTime() - this.WINDOW_DURATION);

    return {
      currentSession: null,
      activeWindow: {
        id: this.generateSessionId(),
        startTime: windowStart,
        endTime: now,
        duration: this.WINDOW_DURATION,
        sessions: [],
        totalTokens: 0,
        totalCost: 0,
        isComplete: false,
      },
      recentSessions: [],
      sessionHistory: [],
      windowDuration: this.WINDOW_DURATION,
      lastActivity: now,
      sessionsInWindow: 0,
      averageSessionLength: 0,
    };
  }

  /**
   * Update session tracking based on token usage data from ccusage blocks
   */
  updateFromBlocks(blocks: CCUsageBlock[]): SessionTracking {
    const now = new Date();

    // Convert ccusage blocks to session format
    const sessions = this.convertBlocksToSessions(blocks);

    // Update the active window with rolling 5-hour period
    this.updateActiveWindow(sessions, now);

    // Identify current active session
    this.updateCurrentSession(sessions);

    // Calculate session statistics
    this.calculateSessionStatistics();

    return this.sessionTracking;
  }

  /**
   * Convert ccusage session blocks to SessionInfo objects
   */
  private convertBlocksToSessions(blocks: CCUsageBlock[]): SessionInfo[] {
    return (
      blocks
        .map((block, index) => this.convertBlockToSession(block, index))
        .filter((session) => !session.isGap) // Filter out gap sessions
        // Newest first — downstream code (recentSessions slice, getSessionTrend's
        // recent-vs-older split, and the sessions[0] "ongoing" candidate) all
        // assume descending order; ccusage returns blocks oldest-first.
        .sort((a, b) => b.startTime.getTime() - a.startTime.getTime())
    );
  }

  private convertBlockToSession(block: CCUsageBlock, index: number): SessionInfo {
    const startTime = new Date(block.startTime);
    const endTime = this.determineEndTime(block);

    return {
      id: block.id || this.generateSessionId(index),
      startTime,
      endTime: block.isActive ? undefined : endTime,
      isActive: block.isActive,
      isGap: block.isGap || false,
      tokensUsed: this.getTotalTokensFromBlock(block),
      duration: this.calculateDuration(block.isActive, startTime, endTime),
      models: block.models || [],
      costUSD: block.costUSD || 0,
      sessionType: this.determineSessionType(block),
    };
  }

  private determineEndTime(block: CCUsageBlock): Date {
    if (block.actualEndTime) {
      return new Date(block.actualEndTime);
    }
    if (block.endTime) {
      return new Date(block.endTime);
    }
    return new Date();
  }

  private calculateDuration(isActive: boolean, startTime: Date, endTime: Date): number {
    return isActive ? Date.now() - startTime.getTime() : endTime.getTime() - startTime.getTime();
  }

  private determineSessionType(block: CCUsageBlock): 'active' | 'gap' | 'completed' {
    if (block.isActive) return 'active';
    if (block.isGap) return 'gap';
    return 'completed';
  }

  /**
   * Update the active 5-hour rolling window
   */
  private updateActiveWindow(sessions: SessionInfo[], now: Date): void {
    const windowStart = new Date(now.getTime() - this.WINDOW_DURATION);

    // Filter sessions within the 5-hour window
    const sessionsInWindow = sessions.filter((session) => session.startTime >= windowStart);

    this.sessionTracking.activeWindow = {
      id: this.sessionTracking.activeWindow.id,
      startTime: windowStart,
      endTime: now,
      duration: this.WINDOW_DURATION,
      sessions: sessionsInWindow,
      totalTokens: sessionsInWindow.reduce((sum, session) => sum + session.tokensUsed, 0),
      totalCost: sessionsInWindow.reduce((sum, session) => sum + session.costUSD, 0),
      isComplete: false,
    };

    this.sessionTracking.sessionsInWindow = sessionsInWindow.length;
    this.sessionTracking.recentSessions = sessionsInWindow.slice(0, 10); // Keep last 10 sessions
  }

  /**
   * Identify and update the current active session
   */
  private updateCurrentSession(sessions: SessionInfo[]): void {
    const activeSession = sessions.find((session) => session.isActive);

    if (activeSession) {
      this.sessionTracking.currentSession = activeSession;
      this.sessionTracking.lastActivity = new Date();
    } else {
      // Check if we should consider the last session as ongoing
      const lastSession = sessions[0]; // Assuming sessions are sorted by start time (newest first)

      if (lastSession && this.isRecentActivity(lastSession)) {
        this.sessionTracking.currentSession = lastSession;
      } else {
        this.sessionTracking.currentSession = null;
      }
    }
  }

  /**
   * Calculate session statistics
   */
  private calculateSessionStatistics(): void {
    const { activeWindow } = this.sessionTracking;
    const completedSessions = activeWindow.sessions.filter((s) => !s.isActive);

    if (completedSessions.length > 0) {
      const totalDuration = completedSessions.reduce((sum, session) => sum + session.duration, 0);
      this.sessionTracking.averageSessionLength = totalDuration / completedSessions.length;
    } else {
      this.sessionTracking.averageSessionLength = 0;
    }
  }

  /**
   * Check if session represents recent activity (within gap threshold)
   */
  private isRecentActivity(session: SessionInfo): boolean {
    const now = Date.now();
    const sessionEnd = session.endTime ? session.endTime.getTime() : session.startTime.getTime();
    return now - sessionEnd < this.SESSION_GAP_THRESHOLD;
  }

  /**
   * Get session progress within current window
   */
  getSessionProgress(): {
    windowProgress: number; // Percentage of 5-hour window completed
    currentSessionProgress: number; // Percentage of current session
    timeInWindow: number; // Total time active in current window
    efficiency: number; // Tokens per minute in window
  } {
    const { activeWindow, currentSession } = this.sessionTracking;
    const now = Date.now();
    const windowStart = activeWindow.startTime.getTime();

    // Calculate window progress
    const windowElapsed = now - windowStart;
    const windowProgress = Math.min(100, (windowElapsed / this.WINDOW_DURATION) * 100);

    // Calculate current session progress (assuming typical session is 1 hour)
    const currentSessionProgress = currentSession
      ? Math.min(100, (currentSession.duration / (60 * 60 * 1000)) * 100)
      : 0;

    // Calculate total active time in window
    const timeInWindow = activeWindow.sessions.reduce((sum, session) => {
      const sessionDuration = session.duration;
      return sum + sessionDuration;
    }, 0);

    // Calculate efficiency (tokens per minute)
    const totalMinutes = timeInWindow / (1000 * 60);
    const efficiency = totalMinutes > 0 ? activeWindow.totalTokens / totalMinutes : 0;

    return {
      windowProgress,
      currentSessionProgress,
      timeInWindow,
      efficiency,
    };
  }

  /**
   * Get session trend analysis
   */
  getSessionTrend(): {
    trend: 'increasing' | 'decreasing' | 'stable';
    recentAverage: number; // tokens per session in recent sessions
    historicalAverage: number; // tokens per session in historical data
    trendPercentage: number;
  } {
    const recentSessions = this.sessionTracking.recentSessions.slice(0, 3);
    const olderSessions = this.sessionTracking.recentSessions.slice(3, 6);

    const recentAverage =
      recentSessions.length > 0
        ? recentSessions.reduce((sum, s) => sum + s.tokensUsed, 0) / recentSessions.length
        : 0;

    const historicalAverage =
      olderSessions.length > 0
        ? olderSessions.reduce((sum, s) => sum + s.tokensUsed, 0) / olderSessions.length
        : 0;

    let trend: 'increasing' | 'decreasing' | 'stable' = 'stable';
    let trendPercentage = 0;

    if (historicalAverage > 0) {
      trendPercentage = ((recentAverage - historicalAverage) / historicalAverage) * 100;

      if (Math.abs(trendPercentage) > 15) {
        trend = trendPercentage > 0 ? 'increasing' : 'decreasing';
      }
    }

    return {
      trend,
      recentAverage,
      historicalAverage,
      trendPercentage: Math.round(trendPercentage * 10) / 10,
    };
  }

  /**
   * Format session duration for display
   */
  formatDuration(milliseconds: number): string {
    const hours = Math.floor(milliseconds / (1000 * 60 * 60));
    const minutes = Math.floor((milliseconds % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }

  /**
   * Get current session tracking state
   */
  getSessionTracking(): SessionTracking {
    return { ...this.sessionTracking };
  }

  /**
   * Helper method to get total tokens from a block. Mirrors
   * ccusageService.getTotalTokensFromBlock — cache-read tokens excluded so
   * the session window numbers don't get inflated 10-100× by prompt-cache
   * hits that don't count toward the user's rate-limit cap.
   */
  private getTotalTokensFromBlock(block: CCUsageBlock): number {
    const counts = block.tokenCounts || {};
    return (
      (counts.inputTokens || 0) +
      (counts.outputTokens || 0) +
      (counts.cacheCreationInputTokens || 0)
    );
  }

  /**
   * Generate unique session ID
   */
  private generateSessionId(index?: number): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `session_${timestamp}_${index || random}`;
  }

  /**
   * Reset session tracking (for testing or manual reset)
   */
  reset(): void {
    this.sessionTracking = this.initializeSessionTracking();
  }

  /**
   * Get session summary for display
   */
  getSessionSummary(): {
    currentStatus: string;
    windowSummary: string;
    efficiency: string;
    recommendation: string;
  } {
    const progress = this.getSessionProgress();
    const trend = this.getSessionTrend();
    const { currentSession, activeWindow } = this.sessionTracking;

    const currentStatus = currentSession
      ? `Active session: ${this.formatDuration(currentSession.duration)}`
      : 'No active session';

    const windowSummary = `${activeWindow.sessions.length} sessions in 5h window`;

    const efficiency =
      progress.efficiency > 0 ? `${Math.round(progress.efficiency)} tokens/min` : 'No activity';

    let recommendation = '';
    if (trend.trend === 'increasing' && trend.trendPercentage > 30) {
      recommendation = '📈 Usage increasing rapidly - consider pacing';
    } else if (trend.trend === 'decreasing') {
      recommendation = '📉 Usage decreasing - good pacing';
    } else if (progress.efficiency > 50) {
      recommendation = '🔥 High intensity session - monitor usage';
    } else {
      recommendation = '✅ Steady usage pattern';
    }

    return {
      currentStatus,
      windowSummary,
      efficiency,
      recommendation,
    };
  }
}
