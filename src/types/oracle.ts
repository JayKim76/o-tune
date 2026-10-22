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
  useDrcp: boolean;
  status: 'CONNECTED' | 'DISCONNECTED' | 'CONNECTING';
  lastConnectedAt?: string;
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


