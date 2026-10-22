// 오라클 SQL 튜닝 시스템 타입 정의

export type AntiPatternType = 
  | 'FULL_TABLE_SCAN'
  | 'JOIN_ORDER_ERROR'
  | 'NL_JOIN_OVERUSE'
  | 'PARSING_OVERHEAD'
  | 'CARDINALITY_MISMATCH';

export interface AntiPatternResult {
  type: AntiPatternType;
  title: string;
  detectedLogic: string;
  recommendation: string;
  suggestedHints: string[];
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface TopSqlItem {
  id: string;
  sqlId: string;
  sqlText: string;
  elapsedTimeSec: number;
  cpuTimeSec: number;
  userIoWaitSec: number;
  bufferGets: number;
  diskReads: number;
  executions: number;
  dbTimePercentage: number;
  normalizedSql?: string;
  antiPatterns: AntiPatternResult[];
  tunedSql?: string;
  tunedPlan?: string;
  executionPlan: string;
}

export interface TuningLearningLoopStep {
  stepNumber: 1 | 2 | 3;
  title: string;
  description: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
  detail: {
    originalContent?: string;
    transformedContent?: string;
    metrics?: {
      beforeValue: string;
      afterValue: string;
      improvement: string;
    };
  };
}

export interface DiagnosticInput {
  rawSql: string;
  executionPlanText: string;
}

export interface DiagnosticOutput {
  normalizedSql: string;
  extractedBindVariables: { name: string; originalValue: string }[];
  detectedAntiPatterns: AntiPatternResult[];
  recommendedHints: string[];
  tunedSql: string;
  originalDbTimeSec: number;
  estimatedTunedDbTimeSec: number;
  benefitRatioPercent: number; // 이 쿼리 자체의 예상 개선율 (스냅샷 전체 DB Time 비중은 AWR 데이터 필요)
}

export interface OracleTuningQueryItem {
  category: string;
  title: string;
  description: string;
  sqlText: string;
}

export interface OracleConnectionConfig {
  host: string;
  port: number;
  serviceName: string;
  username: string;
  password?: string;
  /** 로컬 백엔드 에이전트에 OTUNE_API_TOKEN을 설정한 경우에만 필요하다. 메모리에서만 유지한다. */
  agentToken?: string;
  useDrcp: boolean;
  status: 'CONNECTED' | 'DISCONNECTED' | 'CONNECTING';
  lastConnectedAt?: string;
}

export interface DashboardMetrics {
  activeSessions: number | null;
  /** 인스턴스 시작 이후 누적 기준 버퍼 캐시 히트율(%) */
  bufferCacheHitRatio: number | null;
  instanceStartedAt: string | null;
}

/** 백엔드가 V$SQLSTATS에서 변환해 돌려주는 원시 Top SQL 행 */
export interface OracleTopSqlRow {
  id: string;
  sqlId: string;
  sqlText: string;
  elapsedTimeSec: number;
  cpuTimeSec: number;
  userIoWaitSec: number;
  bufferGets: number;
  diskReads: number;
  executions: number;
  dbTimePercentage: number;
  executionPlan: string;
}

export interface OracleDashboardResponse {
  source: 'live';
  fetchedAt: string;
  items: OracleTopSqlRow[];
  metrics: DashboardMetrics;
  warnings: string[];
}

export interface OracleConnectionTestResult {
  ok: boolean;
  latencyMs: number;
  databaseName: string | null;
  serviceName: string | null;
  currentUser: string | null;
  version: string | null;
}

export interface LmStudioConfig {
  serverUrl: string;
  activeModel: string;
  availableModels: string[];
  status: 'ONLINE' | 'OFFLINE' | 'CHECKING';
  lastCheckedAt?: string;
}

export interface LmStudioDiagnosticResult {
  summary: string;
  antiPatterns: AntiPatternResult[];
  recommendedHints: string[];
  tunedSql: string;
  originalPlanAnalysis: string;
  tunedPlanAnalysis: string;
  estimatedCostReduction: string;
  benefitRatioPercent: number;
  rawModelResponse?: string;
  /** true면 LM Studio 실제 응답이 아니라 폴백(예시) 결과다. 화면에서 반드시 구분 표기할 것. */
  isFallback?: boolean;
  fallbackReason?: string;
}


