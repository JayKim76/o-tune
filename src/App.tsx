import { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { TopSqlDashboard } from './components/TopSqlDashboard';
import { SqlDiagnoser } from './components/SqlDiagnoser';
import { LearningLoopView } from './components/LearningLoopView';
import { PlanDiffViewer } from './components/PlanDiffViewer';
import { TuningToolkit } from './components/TuningToolkit';
import { DbConnectionModal } from './components/DbConnectionModal';
import { LmStudioModal } from './components/LmStudioModal';
import { MOCK_TOP_SQL_LIST } from './data/mockOracleData';
import type { TopSqlItem, OracleConnectionConfig, LmStudioConfig, DashboardMetrics } from './types/oracle';
import { checkLmStudioStatus, DEFAULT_LM_STUDIO_URL } from './utils/lmStudioApi';
import { fetchLiveDashboard } from './utils/oracleBackendApi';

export function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'diagnoser' | 'learning' | 'diff' | 'toolkit'>('dashboard');
  const [selectedSqlItem, setSelectedSqlItem] = useState<TopSqlItem | null>(MOCK_TOP_SQL_LIST[0]);
  const [sqlList, setSqlList] = useState<TopSqlItem[]>(MOCK_TOP_SQL_LIST);
  const [dashboardSource, setDashboardSource] = useState<'SAMPLE' | 'LIVE'>('SAMPLE');
  const [dashboardMetrics, setDashboardMetrics] = useState<DashboardMetrics | null>(null);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [dashboardWarnings, setDashboardWarnings] = useState<string[]>([]);
  const [dashboardLoading, setDashboardLoading] = useState<boolean>(false);
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState<boolean>(false);
  const [isLmModalOpen, setIsLmModalOpen] = useState<boolean>(false);

  const [dbConfig, setDbConfig] = useState<OracleConnectionConfig>({
    host: '192.168.1.100',
    port: 1521,
    serviceName: 'ORCL',
    username: 'SYSTEM',
    useDrcp: true,
    // 실제 DB 연결 기능이 없으므로 연결된 것처럼 표시하지 않는다.
    status: 'DISCONNECTED',
    lastConnectedAt: undefined
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
  }, [lmConfig.serverUrl]);

  // 로컬 백엔드 에이전트를 통해 V$SQLSTATS 실데이터를 가져온다.
  // 실패하면 기존(샘플 또는 직전 실데이터) 목록을 유지하고 오류만 표시한다.
  const loadLiveDashboard = useCallback(async (config: OracleConnectionConfig) => {
    setDashboardLoading(true);
    setDashboardError(null);
    setDbConfig({ ...config, status: 'CONNECTING' });
    try {
      const data = await fetchLiveDashboard(config, 10);
      setSqlList(data.items);
      setDashboardMetrics(data.metrics);
      setDashboardWarnings(data.warnings);
      setDashboardSource('LIVE');
      setLastFetchedAt(new Date(data.fetchedAt).toLocaleTimeString());
      setSelectedSqlItem((prev) =>
        data.items.find((item) => item.sqlId === prev?.sqlId) || data.items[0] || null,
      );
      setDbConfig({
        ...config,
        status: 'CONNECTED',
        lastConnectedAt: new Date(data.fetchedAt).toLocaleTimeString(),
      });
    } catch (error) {
      setDashboardError(error instanceof Error ? error.message : '실데이터 조회에 실패했습니다.');
      setDbConfig({ ...config, status: 'DISCONNECTED', lastConnectedAt: undefined });
    } finally {
      setDashboardLoading(false);
    }
  }, []);

  const handleSaveDbConfig = async (newConfig: OracleConnectionConfig) => {
    setDbConfig(newConfig);
    if (newConfig.status === 'CONNECTED') {
      await loadLiveDashboard(newConfig);
    }
  };

  const handleRefreshDashboard = async () => {
    if (dbConfig.status !== 'CONNECTED' || !dbConfig.password) {
      setDashboardError('실데이터를 새로고침하려면 먼저 Oracle DB 연결 설정에서 연결 테스트를 통과해 주세요.');
      return;
    }
    await loadLiveDashboard(dbConfig);
  };

  const handleSelectSql = (sql: TopSqlItem) => {
    setSelectedSqlItem(sql);
    setActiveTab('diagnoser');
  };

  const topSqlShare = sqlList.reduce((sum, item) => sum + item.dbTimePercentage, 0);
  const dbTimeSummary = `${dashboardSource === 'LIVE' ? '실데이터' : '샘플'} Top ${sqlList.length} · ${topSqlShare.toFixed(1)}%`;

  return (
    <div className="app-layout">
      <Header 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        dbConfig={dbConfig}
        onOpenConnectModal={() => setIsConnectModalOpen(true)}
        lmConfig={lmConfig}
        onOpenLmStudioModal={() => setIsLmModalOpen(true)}
        dbTimeSummary={dbTimeSummary}
      />

      <main className="main-content">
        {activeTab === 'dashboard' && (
          <TopSqlDashboard
            sqlList={sqlList}
            onSelectSql={handleSelectSql}
            dataSource={dashboardSource}
            metrics={dashboardMetrics}
            isLoading={dashboardLoading}
            errorMessage={dashboardError}
            warnings={dashboardWarnings}
            lastFetchedAt={lastFetchedAt}
            onRefresh={handleRefreshDashboard}
            onOpenConnection={() => setIsConnectModalOpen(true)}
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
        onSaveConfig={handleSaveDbConfig}
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
          <p className="footer-note">{dashboardSource === 'LIVE' ? '로컬 백엔드 에이전트 경유 실데이터 조회 중' : '현재 샘플 데이터를 표시 중입니다. DB에 연결하면 실데이터로 전환됩니다.'}</p>
        </div>
      </footer>
    </div>
  );
}

export default App;
