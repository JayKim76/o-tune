import { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { TopSqlDashboard } from './components/TopSqlDashboard';
import { SqlDiagnoser } from './components/SqlDiagnoser';
import { LearningLoopView } from './components/LearningLoopView';
import { PlanDiffViewer } from './components/PlanDiffViewer';
import { TuningToolkit } from './components/TuningToolkit';
import { DbConnectionModal } from './components/DbConnectionModal';
import { LmStudioModal } from './components/LmStudioModal';
import { MOCK_TOP_SQL_LIST } from './data/mockOracleData';
import type { TopSqlItem, OracleConnectionConfig, LmStudioConfig } from './types/oracle';
import { checkLmStudioStatus, DEFAULT_LM_STUDIO_URL } from './utils/lmStudioApi';

export function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'diagnoser' | 'learning' | 'diff' | 'toolkit'>('dashboard');
  const [selectedSqlItem, setSelectedSqlItem] = useState<TopSqlItem | null>(MOCK_TOP_SQL_LIST[0]);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState<boolean>(false);
  const [isLmModalOpen, setIsLmModalOpen] = useState<boolean>(false);

  const [dbConfig, setDbConfig] = useState<OracleConnectionConfig>({
    host: '192.168.1.100',
    port: 1521,
    serviceName: 'ORCL',
    username: 'SYSTEM',
    useDrcp: true,
    status: 'CONNECTED',
    lastConnectedAt: '15:00:00'
  });

  const [lmConfig, setLmConfig] = useState<LmStudioConfig>({
    serverUrl: DEFAULT_LM_STUDIO_URL,
    activeModel: '',
    availableModels: [],
    status: 'CHECKING',
  });

  // 앱 로드 시 LM Studio 서버 온/오프라인 상태 및 모델 목록 자동 감지
  useEffect(() => {
    let isMounted = true;
    checkLmStudioStatus(lmConfig.serverUrl).then((res) => {
      if (!isMounted) return;
      if (res.isOnline) {
        setLmConfig((prev) => ({
          ...prev,
          status: 'ONLINE',
          availableModels: res.models,
          activeModel: res.models[0] || 'default-model',
          lastCheckedAt: new Date().toLocaleTimeString(),
        }));
      } else {
        setLmConfig((prev) => ({
          ...prev,
          status: 'OFFLINE',
          availableModels: [],
          lastCheckedAt: new Date().toLocaleTimeString(),
        }));
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  const handleSelectSql = (sql: TopSqlItem) => {
    setSelectedSqlItem(sql);
    setActiveTab('diagnoser');
  };

  return (
    <div className="app-layout">
      <Header 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        dbConfig={dbConfig}
        onOpenConnectModal={() => setIsConnectModalOpen(true)}
        lmConfig={lmConfig}
        onOpenLmStudioModal={() => setIsLmModalOpen(true)}
      />

      <main className="main-content">
        {activeTab === 'dashboard' && (
          <TopSqlDashboard 
            sqlList={MOCK_TOP_SQL_LIST} 
            onSelectSql={handleSelectSql} 
          />
        )}

        {activeTab === 'diagnoser' && (
          <SqlDiagnoser 
            selectedSqlItem={selectedSqlItem} 
            lmConfig={lmConfig}
            onOpenLmStudioModal={() => setIsLmModalOpen(true)}
          />
        )}

        {activeTab === 'learning' && (
          <LearningLoopView />
        )}

        {activeTab === 'diff' && (
          <PlanDiffViewer 
            selectedSqlItem={selectedSqlItem} 
          />
        )}

        {activeTab === 'toolkit' && (
          <TuningToolkit />
        )}
      </main>

      {/* 오라클 DB 연결 설정 모달 */}
      <DbConnectionModal
        isOpen={isConnectModalOpen}
        onClose={() => setIsConnectModalOpen(false)}
        config={dbConfig}
        onSaveConfig={(newConfig) => setDbConfig(newConfig)}
      />

      {/* LM Studio 로컬 AI 설정 모달 */}
      <LmStudioModal
        isOpen={isLmModalOpen}
        onClose={() => setIsLmModalOpen(false)}
        config={lmConfig}
        onSaveConfig={(newConfig) => setLmConfig(newConfig)}
      />

      <footer className="app-footer">
        <div className="footer-content">
          <p>© 2026 오튠 (Oracle Tuning AI Solution) | Oracle DB: {dbConfig.host}:{dbConfig.port}/{dbConfig.serviceName} | Local AI: {lmConfig.serverUrl} ({lmConfig.status})</p>
          <p className="footer-note">LM Studio 로컬 AI 모델 기반 Oracle SQL 자동 튜닝 & DB Time 절감 가이드 준수</p>
        </div>
      </footer>
    </div>
  );
}

export default App;
