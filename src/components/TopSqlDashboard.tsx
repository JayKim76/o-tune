import React from 'react';
import type { TopSqlItem } from '../types/oracle';
import { Activity, Clock, Database, AlertTriangle, ArrowRight, Zap, Cpu, HardDrive, Sparkles, ChevronRight } from 'lucide-react';

interface TopSqlDashboardProps {
  sqlList: TopSqlItem[];
  onSelectSql: (sql: TopSqlItem) => void;
}

export const TopSqlDashboard: React.FC<TopSqlDashboardProps> = ({ sqlList, onSelectSql }) => {
  return (
    <div className="dashboard-container">
      {/* Top Section Header */}
      <div className="section-header">
        <div>
          <h2 className="section-title">
            <Activity className="icon text-cyan" />
            <span>v$sqlstats 기반 Top High-Load SQL 미션 컨트롤</span>
          </h2>
          <p className="section-subtitle">
            Oracle DB 성능을 실시간 모니터링하고 DB Time 점유율이 높은 쿼리에 대해 AI 튜닝을 즉시 적용합니다.
          </p>
        </div>
        <div className="stat-badge">
          <span>실시간 튜닝 대상: <strong>{sqlList.length} 개 쿼리</strong></span>
        </div>
      </div>

      {/* KPI & Global Gauge Row (Stitch MCP Design System) */}
      <div className="kpi-gauge-grid margin-bottom-lg">
        {/* 1. Global Performance Ring Gauge Card */}
        <div className="obsidian-kpi-card gauge-card">
          <div className="gauge-container">
            <svg viewBox="0 0 100 60" className="ring-gauge-svg">
              <path
                d="M 10 50 A 40 40 0 0 1 90 50"
                fill="none"
                stroke="rgba(255, 255, 255, 0.08)"
                strokeWidth="10"
                strokeLinecap="round"
              />
              <path
                d="M 10 50 A 40 40 0 0 1 90 50"
                fill="none"
                stroke="url(#cyanGlowGrad)"
                strokeWidth="10"
                strokeDasharray="125.6"
                strokeDashoffset="13.8"
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
              <span className="gauge-percent">89%</span>
              <span className="gauge-label">Global Health</span>
            </div>
          </div>
          <div className="gauge-meta">
            <span className="meta-title">DB Time Score</span>
            <span className="meta-status text-green">Optimal Status</span>
          </div>
        </div>

        {/* 2. Active Sessions KPI Card */}
        <div className="obsidian-kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">Active Sessions</span>
            <span className="kpi-trend text-green">+16.8%</span>
          </div>
          <div className="kpi-body">
            <div className="kpi-num-group">
              <span className="kpi-value text-main">56</span>
              <span className="kpi-unit">sessions</span>
            </div>
            {/* Sparkline SVG */}
            <div className="sparkline-wrap">
              <svg className="sparkline-svg" viewBox="0 0 100 24">
                <polyline
                  fill="none"
                  stroke="#10b981"
                  strokeWidth="2"
                  points="0,20 15,18 30,12 45,15 60,8 75,10 90,4 100,6"
                />
              </svg>
            </div>
          </div>
          <div className="kpi-foot">
            <Activity className="icon-xs text-green" />
            <span>Optimal Workload Distribution</span>
          </div>
        </div>

        {/* 3. IOPS Metric KPI Card */}
        <div className="obsidian-kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">User I/O IOPS</span>
            <span className="kpi-trend text-cyan">+10.8%</span>
          </div>
          <div className="kpi-body">
            <div className="kpi-num-group">
              <span className="kpi-value text-cyan">222</span>
              <span className="kpi-unit">k IOPS</span>
            </div>
            {/* Sparkline SVG */}
            <div className="sparkline-wrap">
              <svg className="sparkline-svg" viewBox="0 0 100 24">
                <polyline
                  fill="none"
                  stroke="#06b6d4"
                  strokeWidth="2"
                  points="0,16 15,14 30,19 45,10 60,12 75,5 90,7 100,2"
                />
              </svg>
            </div>
          </div>
          <div className="kpi-foot">
            <HardDrive className="icon-xs text-cyan" />
            <span>NVMe Flash Array I/O Wait 0.4ms</span>
          </div>
        </div>

        {/* 4. Memory / Buffer Gets KPI Card */}
        <div className="obsidian-kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">SGA / Buffer Cache</span>
            <span className="kpi-trend text-amber">-1.3%</span>
          </div>
          <div className="kpi-body">
            <div className="kpi-num-group">
              <span className="kpi-value text-amber">100</span>
              <span className="kpi-unit">MB/s</span>
            </div>
            {/* Sparkline SVG */}
            <div className="sparkline-wrap">
              <svg className="sparkline-svg" viewBox="0 0 100 24">
                <polyline
                  fill="none"
                  stroke="#f59e0b"
                  strokeWidth="2"
                  points="0,8 15,10 30,6 45,14 60,11 75,18 90,15 100,20"
                />
              </svg>
            </div>
          </div>
          <div className="kpi-foot">
            <Cpu className="icon-xs text-amber" />
            <span>Cache Hit Ratio 99.4%</span>
          </div>
        </div>
      </div>

      {/* Main Grid: Left SQL List vs Right AI Recommendation Floating Panel */}
      <div className="dashboard-main-split">
        {/* Left: Top High-Load SQL List */}
        <div className="sql-card-grid">
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

              {/* DB Time 점유 프로그레스 바 */}
              <div className="progress-container">
                <div 
                  className="progress-bar" 
                  style={{ width: `${item.dbTimePercentage}%` }}
                ></div>
              </div>

              {/* 메트릭 그리드 */}
              <div className="metrics-row">
                <div className="metric-box">
                  <Clock className="box-icon text-cyan" />
                  <span className="box-label">총 소요시간</span>
                  <span className="box-value">{item.elapsedTimeSec} 초</span>
                </div>
                <div className="metric-box">
                  <Activity className="box-icon text-purple" />
                  <span className="box-label">CPU 시간</span>
                  <span className="box-value">{item.cpuTimeSec} 초</span>
                </div>
                <div className="metric-box">
                  <Database className="box-icon text-amber" />
                  <span className="box-label">User I/O 대기</span>
                  <span className="box-value">{item.userIoWaitSec} 초</span>
                </div>
                <div className="metric-box">
                  <span className="box-label">Buffer Gets</span>
                  <span className="box-value">{item.bufferGets.toLocaleString()}</span>
                </div>
              </div>

              {/* SQL 텍스트 코드 블록 */}
              <div className="code-snippet-box">
                <pre className="code-content">{item.sqlText}</pre>
              </div>

              {/* 안티패턴 태그 */}
              <div className="antipattern-tags">
                {item.antiPatterns.map((ap, i) => (
                  <span key={i} className={`ap-tag ap-${ap.severity.toLowerCase()}`}>
                    <AlertTriangle className="ap-icon" />
                    {ap.title}
                  </span>
                ))}
              </div>

              {/* 액션 버튼 */}
              <div className="card-actions">
                <button 
                  className="action-btn primary-btn"
                  onClick={() => onSelectSql(item)}
                >
                  <Zap className="btn-icon text-amber" />
                  <span>AI Rule Engine 자동 튜닝 및 진단</span>
                  <ArrowRight className="btn-arrow" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Right: AI Auto-Tuning Recommendations Panel (Obsidian Query Stitch Style) */}
        <div className="ai-recommendations-panel">
          <div className="panel-header">
            <Sparkles className="panel-icon text-amethyst" />
            <div>
              <h3 className="panel-title">AI Auto-Tuning Insights</h3>
              <p className="panel-sub">LM Studio 로컬 AI 가동 중</p>
            </div>
          </div>

          <div className="ai-cards-stack">
            {/* AI Recommendation Card 1 */}
            <div className="obsidian-ai-card">
              <div className="ai-card-top">
                <span className="ai-badge">High Priority</span>
                <span className="gain-tag text-green">+85.4% Gain</span>
              </div>
              <h4 className="ai-card-title">복합 인덱스 (JOB, SAL) 생성 제안</h4>
              <p className="ai-card-desc">
                EMP 테이블에 FULL SCAN 병목이 발생하고 있습니다. 인덱스를 추가하여 INDEX RANGE SCAN으로 전환하십시오.
              </p>
              <div className="ai-code-chip">
                <code>CREATE INDEX idx_emp_job_sal ON emp(job, sal);</code>
              </div>
              <button className="ai-apply-btn" onClick={() => onSelectSql(sqlList[0])}>
                <span>튜닝 자동 적용 시뮬레이션</span>
                <ChevronRight className="icon-xs" />
              </button>
            </div>

            {/* AI Recommendation Card 2 */}
            <div className="obsidian-ai-card">
              <div className="ai-card-top">
                <span className="ai-badge purple-badge">SQL Rewrite</span>
                <span className="gain-tag text-cyan">+62.0% Gain</span>
              </div>
              <h4 className="ai-card-title">리터럴 상수 바인드 변수화 (:B1)</h4>
              <p className="ai-card-desc">
                HARD PARSE(하드 파싱)로 인한 Shared Pool CPU 점유율 증가를 방지하기 위해 바인드 변수화가 필요합니다.
              </p>
              <div className="ai-code-chip">
                <code>WHERE job = :b1 AND sal &gt; :b2</code>
              </div>
              <button className="ai-apply-btn" onClick={() => onSelectSql(sqlList[0])}>
                <span>튜닝 자동 적용 시뮬레이션</span>
                <ChevronRight className="icon-xs" />
              </button>
            </div>

            {/* AI Recommendation Card 3 */}
            <div className="obsidian-ai-card">
              <div className="ai-card-top">
                <span className="ai-badge cyan-badge">Optimizer Hint</span>
                <span className="gain-tag text-green">+92.1% Gain</span>
              </div>
              <h4 className="ai-card-title">LEADING(e d) USE_NL(d) 힌트 주입</h4>
              <p className="ai-card-desc">
                대용량 테이블 HASH JOIN 대신 인덱스 기반 NESTED LOOPS JOIN으로 조인 방식을 전환합니다.
              </p>
              <div className="ai-code-chip">
                <code>/*+ LEADING(e d) USE_NL(d) */</code>
              </div>
              <button className="ai-apply-btn" onClick={() => onSelectSql(sqlList[0])}>
                <span>튜닝 자동 적용 시뮬레이션</span>
                <ChevronRight className="icon-xs" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

