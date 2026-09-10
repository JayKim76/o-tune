import React from 'react';
import type { OracleConnectionConfig, LmStudioConfig } from '../types/oracle';
import { Database, Zap, Activity, BookOpen, Layers, LineChart, Settings, CheckCircle2, Bot } from 'lucide-react';

interface HeaderProps {
  activeTab: 'dashboard' | 'diagnoser' | 'learning' | 'diff' | 'toolkit';
  setActiveTab: (tab: 'dashboard' | 'diagnoser' | 'learning' | 'diff' | 'toolkit') => void;
  dbConfig: OracleConnectionConfig;
  onOpenConnectModal: () => void;
  lmConfig: LmStudioConfig;
  onOpenLmStudioModal: () => void;
}

export const Header: React.FC<HeaderProps> = ({ 
  activeTab, 
  setActiveTab,
  dbConfig,
  onOpenConnectModal,
  lmConfig,
  onOpenLmStudioModal
}) => {
  return (
    <header className="app-header">
      <div className="header-top">
        <div className="brand">
          <div className="brand-icon">
            <Database className="icon" />
            <Zap className="icon-overlay" />
          </div>
          <div>
            <h1 className="brand-title">오튠 <span className="brand-subtitle">Oracle Tuning AI Solution</span></h1>
            <p className="brand-desc">DB Time 최소화 및 LM Studio 로컬 AI + Rule Engine 기반 Oracle SQL 자동 튜닝 솔루션</p>
          </div>
        </div>

        <div className="system-metrics">
          {/* LM Studio 로컬 AI 연결 상태 */}
          <div className="connection-pill-btn lm-pill" onClick={onOpenLmStudioModal} title="LM Studio 로컬 AI 연결 설정">
            <Bot className="pill-icon text-amber" />
            <div>
              <span className="pill-label">LM Studio Local AI</span>
              <span className={`pill-value flex-align ${lmConfig.status === 'ONLINE' ? 'text-green' : 'text-amber'}`}>
                <CheckCircle2 className={`icon-sm ${lmConfig.status === 'ONLINE' ? 'text-green' : 'text-amber'}`} />
                {lmConfig.status === 'ONLINE' ? (lmConfig.activeModel || 'LM Studio Online') : 'LM Studio Offline'}
              </span>
            </div>
            <Settings className="settings-gear icon" />
          </div>

          {/* DB 커넥션 상태 및 버튼 */}
          <div className="connection-pill-btn" onClick={onOpenConnectModal} title="오라클 DB 연결 설정 변경">
            <Database className="pill-icon text-cyan" />
            <div>
              <span className="pill-label">Oracle DB Session</span>
              <span className="pill-value text-green flex-align">
                <CheckCircle2 className="icon-sm text-green" />
                {dbConfig.host}:{dbConfig.port}/{dbConfig.serviceName}
              </span>
            </div>
            <Settings className="settings-gear icon" />
          </div>

          <div className="metric-pill">
            <Activity className="pill-icon text-cyan" />
            <div>
              <span className="pill-label">Total DB Time</span>
              <span className="pill-value text-cyan">42.8 초 / min</span>
            </div>
          </div>
        </div>
      </div>

      <nav className="nav-tabs">
        <button 
          className={`nav-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
          onClick={() => setActiveTab('dashboard')}
        >
          <Activity className="btn-icon" />
          <span>Top High-Load SQL 대시보드</span>
        </button>

        <button 
          className={`nav-btn ${activeTab === 'diagnoser' ? 'active' : ''}`}
          onClick={() => setActiveTab('diagnoser')}
        >
          <Zap className="btn-icon" />
          <span>SQL & 실행계획 AI 자동 진단</span>
        </button>

        <button 
          className={`nav-btn ${activeTab === 'learning' ? 'active' : ''}`}
          onClick={() => setActiveTab('learning')}
        >
          <LineChart className="btn-icon" />
          <span>3단계 AI 학습 루프 (Feedback)</span>
        </button>

        <button 
          className={`nav-btn ${activeTab === 'diff' ? 'active' : ''}`}
          onClick={() => setActiveTab('diff')}
        >
          <Layers className="btn-icon" />
          <span>실행계획 Visual Diff 비교</span>
        </button>

        <button 
          className={`nav-btn ${activeTab === 'toolkit' ? 'active' : ''}`}
          onClick={() => setActiveTab('toolkit')}
        >
          <BookOpen className="btn-icon" />
          <span>DBA 튜닝 쿼리 & 팁 툴킷</span>
        </button>
      </nav>
    </header>
  );
};
