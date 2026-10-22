import React from 'react';
import type { DashboardMetrics, TopSqlItem } from '../types/oracle';
import { Activity, Clock, Database, AlertTriangle, ArrowRight, Zap, HardDrive, Sparkles, ChevronRight, RefreshCw } from 'lucide-react';

interface TopSqlDashboardProps {
  sqlList: TopSqlItem[];
  onSelectSql: (sql: TopSqlItem) => void;
  dataSource: 'SAMPLE' | 'LIVE';
  metrics: DashboardMetrics | null;
  isLoading: boolean;
  errorMessage: string | null;
  warnings: string[];
  lastFetchedAt: string | null;
  onRefresh: () => void;
  onOpenConnection: () => void;
}

const compact = (value: number) =>
  new Intl.NumberFormat('ko-KR', { notation: 'compact', maximumFractionDigits: 1 }).format(value);

const seconds = (value: number) => `${Number(value.toFixed(2)).toLocaleString()} 초`;

const severityRank = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;

export const TopSqlDashboard: React.FC<TopSqlDashboardProps> = ({
  sqlList,
  onSelectSql,
  dataSource,
  metrics,
  isLoading,
  errorMessage,
  warnings,
  lastFetchedAt,
  onRefresh,
  onOpenConnection,
}) => {
  const isLive = dataSource === 'LIVE';
  const totalShare = Math.min(100, sqlList.reduce((sum, item) => sum + item.dbTimePercentage, 0));
  const gaugeOffset = 125.6 - (125.6 * totalShare) / 100;
  const totalExecutions = sqlList.reduce((sum, item) => sum + item.executions, 0);
  const totalBufferGets = sqlList.reduce((sum, item) => sum + item.bufferGets, 0);
  const totalDiskReads = sqlList.reduce((sum, item) => sum + item.diskReads, 0);
  const totalUserIoWait = sqlList.reduce((sum, item) => sum + item.userIoWaitSec, 0);

  // 추천 카드는 고정 문구가 아니라 현재 목록의 안티패턴에서 동적으로 만든다.
  const recommendations = sqlList
    .flatMap((item) => item.antiPatterns.map((ap) => ({ item, ap })))
    .sort((a, b) =>
      severityRank[a.ap.severity] - severityRank[b.ap.severity]
      || b.item.dbTimePercentage - a.item.dbTimePercentage,
    )
    .slice(0, 3);

  return (
    <div className="dashboard-container">
      <div className="section-header">
        <div>
          <h2 className="section-title">
            <Activity className="icon text-cyan" />
            <span>v$sqlstats 기반 Top High-Load SQL 미션 컨트롤</span>
          </h2>
          <p className="section-subtitle">
            {isLive
              ? '로컬 백엔드 에이전트가 Oracle V$SQLSTATS에서 조회한 실데이터입니다.'
              : 'DB 연결 전 샘플 데이터입니다. Oracle에 연결하면 V$SQLSTATS 실데이터로 전환됩니다.'}
          </p>
        </div>
        <div className="header-actions">
          <div className="stat-badge">
            <span>{isLive ? `실데이터 · 마지막 조회 ${lastFetchedAt || '-'}` : '샘플 데이터'} · <strong>{sqlList.length} 개 쿼리</strong></span>
          </div>
          {isLive ? (
            <button className="action-btn" onClick={onRefresh} disabled={isLoading}>
              <RefreshCw className={`icon ${isLoading ? 'animate-spin' : ''}`} />
              <span>{isLoading ? '조회 중...' : '새로고침'}</span>
            </button>
          ) : (
            <button className="action-btn" onClick={onOpenConnection}>
              <Database className="icon text-cyan" />
              <span>DB 연결 설정</span>
            </button>
          )}
        </div>
      </div>

      {errorMessage && (
        <div className="status-banner error animate-fade-in">
          <AlertTriangle className="icon text-red" />
          <span>{errorMessage}</span>
        </div>
      )}
      {!errorMessage && !isLive && (
        <div className="status-banner info animate-fade-in">
          <AlertTriangle className="icon text-amber" />
          <span>아래 수치와 목록은 샘플 데이터 기준입니다. 실제 판단에는 사용하지 마세요.</span>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="status-banner info animate-fade-in">
          <AlertTriangle className="icon text-amber" />
          <span>일부 항목을 가져오지 못했습니다: {warnings.slice(0, 2).join(' / ')}{warnings.length > 2 ? ` 외 ${warnings.length - 2}건` : ''}</span>
        </div>
      )}

      {/* KPI Row: 모든 수치를 현재 sqlList와 실측 지표에서 계산한다 */}
      <div className="kpi-gauge-grid margin-bottom-lg">
        <div className="obsidian-kpi-card gauge-card">
          <div className="gauge-container">
            <svg viewBox="0 0 100 60" className="ring-gauge-svg">
              <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="rgba(255, 255, 255, 0.08)" strokeWidth="10" strokeLinecap="round" />
              <path
                d="M 10 50 A 40 40 0 0 1 90 50"
                fill="none"
                stroke="url(#cyanGlowGrad)"
                strokeWidth="10"
                strokeDasharray="125.6"
                strokeDashoffset={gaugeOffset}
                strokeLinecap="round"
              />
              <defs>
                <linearGradient id="cyanGlowGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#06b6d4" />
                  <stop offset="100%" stopColor="#38bdf8" />
                </linearGradient>
              </defs>
            </svg>
            <div className="gauge-center-text">
              <span className="gauge-percent">{totalShare.toFixed(1)}%</span>
              <span className="gauge-label">Top SQL Share</span>
            </div>
          </div>
          <div className="gauge-meta">
            <span className="meta-title">표시 중인 쿼리의 DB Time 비중 합계</span>
            <span className="meta-status text-green">{isLive ? 'V$SQLSTATS 실측' : '샘플 데이터'}</span>
          </div>
        </div>

        <div className="obsidian-kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">{metrics?.activeSessions != null ? 'Active Sessions' : 'Top SQL 총 수행횟수'}</span>
            <span className="kpi-trend text-green">{isLive ? '실데이터' : '샘플'}</span>
          </div>
          <div className="kpi-body">
            <div className="kpi-num-group">
              <span className="kpi-value text-main">{metrics?.activeSessions != null ? metrics.activeSessions : compact(totalExecutions)}</span>
              <span className="kpi-unit">{metrics?.activeSessions != null ? 'sessions' : '회'}</span>
            </div>
          </div>
          <div className="kpi-foot">
            <Activity className="icon-xs text-green" />
            <span>{metrics?.activeSessions != null ? 'V$SESSION ACTIVE 기준' : '표시 중인 SQL executions 합계'}</span>
          </div>
        </div>

        <div className="obsidian-kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">Top SQL Disk Reads</span>
            <span className="kpi-trend text-cyan">{isLive ? '실데이터' : '샘플'}</span>
          </div>
          <div className="kpi-body">
            <div className="kpi-num-group">
              <span className="kpi-value text-cyan">{compact(totalDiskReads)}</span>
              <span className="kpi-unit">reads</span>
            </div>
          </div>
          <div className="kpi-foot">
            <HardDrive className="icon-xs text-cyan" />
            <span>User I/O 대기 합계 {seconds(totalUserIoWait)}</span>
          </div>
        </div>

        <div className="obsidian-kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">{metrics?.bufferCacheHitRatio != null ? 'Buffer Cache Hit Ratio' : 'Top SQL Buffer Gets'}</span>
            <span className="kpi-trend text-amber">{isLive ? '실데이터' : '샘플'}</span>
          </div>
          <div className="kpi-body">
            <div className="kpi-num-group">
              <span className="kpi-value text-amber">{metrics?.bufferCacheHitRatio != null ? metrics.bufferCacheHitRatio : compact(totalBufferGets)}</span>
              <span className="kpi-unit">{metrics?.bufferCacheHitRatio != null ? '%' : 'gets'}</span>
            </div>
          </div>
          <div className="kpi-foot">
            <Database className="icon-xs text-amber" />
            <span>{metrics?.bufferCacheHitRatio != null ? '인스턴스 시작 이후 누적 기준' : '표시 중인 SQL buffer_gets 합계'}</span>
          </div>
        </div>
      </div>

      <div className="dashboard-main-split">
        <div className="sql-card-grid">
          {sqlList.length === 0 && (
            <div className="sql-card">
              <p className="section-subtitle">표시할 SQL이 없습니다. V$SQLSTATS에 누적된 실행 통계가 있는지 확인해 주세요.</p>
            </div>
          )}
          {sqlList.map((item, index) => (
            <div key={item.id} className="sql-card">
              <div className="card-top">
                <div className="card-title-group">
                  <span className="rank-badge">#{index + 1}</span>
                  <span className="sql-id-tag">SQL_ID: {item.sqlId}</span>
                  <span className="execution-tag">{item.executions.toLocaleString()} 회 수행</span>
                </div>
                <div className="db-time-share">
                  <span className="share-label">DB Time 점유율</span>
                  <span className="share-value">{item.dbTimePercentage}%</span>
                </div>
              </div>

              <div className="progress-container">
                <div className="progress-bar" style={{ width: `${Math.min(100, item.dbTimePercentage)}%` }}></div>
              </div>

              <div className="metrics-row">
                <div className="metric-box">
                  <Clock className="box-icon text-cyan" />
                  <span className="box-label">총 소요시간</span>
                  <span className="box-value">{seconds(item.elapsedTimeSec)}</span>
                </div>
                <div className="metric-box">
                  <Activity className="box-icon text-purple" />
                  <span className="box-label">CPU 시간</span>
                  <span className="box-value">{seconds(item.cpuTimeSec)}</span>
                </div>
                <div className="metric-box">
                  <Database className="box-icon text-amber" />
                  <span className="box-label">User I/O 대기</span>
                  <span className="box-value">{seconds(item.userIoWaitSec)}</span>
                </div>
                <div className="metric-box">
                  <span className="box-label">Buffer Gets</span>
                  <span className="box-value">{item.bufferGets.toLocaleString()}</span>
                </div>
              </div>

              <div className="code-snippet-box">
                <pre className="code-content">{item.sqlText}</pre>
              </div>

              <div className="antipattern-tags">
                {item.antiPatterns.map((ap, i) => (
                  <span key={i} className={`ap-tag ap-${ap.severity.toLowerCase()}`}>
                    <AlertTriangle className="ap-icon" />
                    {ap.title}
                  </span>
                ))}
                {item.antiPatterns.length === 0 && (
                  <span className="ap-tag ap-low">탐지된 안티패턴 없음</span>
                )}
              </div>

              <div className="card-actions">
                <button className="action-btn primary-btn" onClick={() => onSelectSql(item)}>
                  <Zap className="btn-icon text-amber" />
                  <span>AI Rule Engine 자동 튜닝 및 진단</span>
                  <ArrowRight className="btn-arrow" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="ai-recommendations-panel">
          <div className="panel-header">
            <Sparkles className="panel-icon text-amethyst" />
            <div>
              <h3 className="panel-title">AI Auto-Tuning Insights</h3>
              <p className="panel-sub">{isLive ? '실데이터 기반 규칙 엔진 분석' : '샘플 데이터 기반 규칙 엔진 예시'}</p>
            </div>
          </div>

          <div className="ai-cards-stack">
            {recommendations.map(({ item, ap }, index) => (
              <div key={`${item.id}-${ap.type}-${index}`} className="obsidian-ai-card">
                <div className="ai-card-top">
                  <span className={`ai-badge ${index === 1 ? 'purple-badge' : index === 2 ? 'cyan-badge' : ''}`}>
                    {ap.severity === 'HIGH' ? 'High Priority' : ap.severity === 'MEDIUM' ? 'Medium Priority' : 'Low Priority'}
                  </span>
                  <span className="gain-tag text-green">DB Time {item.dbTimePercentage}%</span>
                </div>
                <h4 className="ai-card-title">{ap.title}</h4>
                <p className="ai-card-desc">{ap.recommendation}</p>
                {ap.suggestedHints[0] && (
                  <div className="ai-code-chip">
                    <code>{ap.suggestedHints[0]}</code>
                  </div>
                )}
                <button className="ai-apply-btn" onClick={() => onSelectSql(item)}>
                  <span>이 SQL 진단하기</span>
                  <ChevronRight className="icon-xs" />
                </button>
              </div>
            ))}
            {recommendations.length === 0 && (
              <div className="obsidian-ai-card">
                <h4 className="ai-card-title">탐지된 안티패턴이 없습니다</h4>
                <p className="ai-card-desc">개별 SQL을 선택해 실행계획 진단을 실행해 주세요.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
