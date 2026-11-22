import React, { useState } from 'react';
import type { OracleConnectionConfig, TopSqlItem } from '../types/oracle';
import { parsePlanCost, parsePlanTimeSec } from '../utils/sqlParser';
import { fetchExplainPlan } from '../utils/oracleBackendApi';
import { Layers, TrendingDown, Clock, Database, Eye, RefreshCw, AlertTriangle } from 'lucide-react';

interface PlanDiffViewerProps {
  selectedSqlItem?: TopSqlItem | null;
  dbConfig?: OracleConnectionConfig | null;
}

export const PlanDiffViewer: React.FC<PlanDiffViewerProps> = ({ selectedSqlItem, dbConfig }) => {
  const [estimatedPlan, setEstimatedPlan] = useState<string | null>(null);
  const [explainError, setExplainError] = useState<string | null>(null);
  const [isExplaining, setIsExplaining] = useState<boolean>(false);

  // 선택한 SQL이 바뀌면 이전 예상 계획은 버린다.
  const [planOwnerSqlId, setPlanOwnerSqlId] = useState<string | undefined>(selectedSqlItem?.sqlId);
  if (planOwnerSqlId !== selectedSqlItem?.sqlId) {
    setPlanOwnerSqlId(selectedSqlItem?.sqlId);
    setEstimatedPlan(null);
    setExplainError(null);
  }

  const item = selectedSqlItem || {
    sqlId: '9a8bc7def123',
    sqlText: `SELECT e.empno, e.ename, d.dname, e.sal
FROM emp e, dept d
WHERE e.deptno = d.deptno
  AND e.job = 'MANAGER'
  AND e.sal > 3000`,
    tunedSql: `SELECT /*+ INDEX(e idx_emp_job_sal) LEADING(e d) USE_NL(d) */ e.empno, e.ename, d.dname, e.sal
FROM emp e, dept d
WHERE e.deptno = d.deptno
  AND e.job = :b1
  AND e.sal > :b2`,
    executionPlan: `-------------------------------------------------------------------------------------------------
| Id  | Operation                  | Name  | Rows  | Bytes | Cost (%CPU)| Time     |
-------------------------------------------------------------------------------------------------
|   0 | SELECT STATEMENT           |       |  1450 | 58000 |  1240   (2)| 00:00:15 |
|*  1 |  HASH JOIN                 |       |  1450 | 58000 |  1240   (2)| 00:00:15 |
|*  2 |   TABLE ACCESS FULL        | EMP   | 14500 | 435000|  1120   (2)| 00:00:14 |
|   3 |   TABLE ACCESS FULL        | DEPT  |     4 |    40 |     3   (0)| 00:00:01 |
-------------------------------------------------------------------------------------------------`,
    tunedPlan: `-------------------------------------------------------------------------------------------------
| Id  | Operation                   | Name            | Rows  | Bytes | Cost (%CPU)| Time     |
-------------------------------------------------------------------------------------------------
|   0 | SELECT STATEMENT            |                 |  1450 | 58000 |    12   (0)| 00:00:01 |
|   1 |  NESTED LOOPS               |                 |  1450 | 58000 |    12   (0)| 00:00:01 |
|   2 |   TABLE ACCESS BY INDEX ROWID| EMP             |   145 |  4350 |     8   (0)| 00:00:01 |
|*  3 |    INDEX RANGE SCAN         | IDX_EMP_JOB_SAL |  145 |     0 |     2   (0)| 00:00:01 |
|   4 |   TABLE ACCESS BY INDEX ROWID| DEPT            |     1 |    10 |     1   (0)| 00:00:01 |
|*  5 |    INDEX UNIQUE SCAN        | PK_DEPT         |     1 |     0 |     0   (0)| 00:00:01 |
-------------------------------------------------------------------------------------------------`,
    elapsedTimeSec: 28.45,
    bufferGets: 845200
  };

  const isConnected = dbConfig?.status === 'CONNECTED' && Boolean(dbConfig?.password);
  // 표시할 튜닝 후 계획: 실행된 실제 계획이 있으면 그것, 없으면 EXPLAIN PLAN 예상 계획.
  const displayTunedPlan = item.tunedPlan || estimatedPlan;
  const isEstimated = !item.tunedPlan && Boolean(estimatedPlan);

  const handleExplain = async () => {
    if (!dbConfig || !item.tunedSql) return;
    setIsExplaining(true);
    setExplainError(null);
    try {
      const result = await fetchExplainPlan(dbConfig, item.tunedSql);
      setEstimatedPlan(result.planText);
    } catch (error) {
      setExplainError(error instanceof Error ? error.message : 'EXPLAIN PLAN 조회에 실패했습니다.');
    } finally {
      setIsExplaining(false);
    }
  };

  // 성과 수치는 고정값이 아니라 실행계획 텍스트에서 직접 파싱해 계산한다.
  // 예상 계획의 수치는 옵티마이저 추정치이며 실측이 아니다.
  const origCost = parsePlanCost(item.executionPlan);
  const tunedCost = displayTunedPlan ? parsePlanCost(displayTunedPlan) : null;
  const costReduction = origCost && tunedCost
    ? Number((((origCost - tunedCost) / origCost) * 100).toFixed(1))
    : null;
  const origTime = parsePlanTimeSec(item.executionPlan);
  const tunedTime = displayTunedPlan ? parsePlanTimeSec(displayTunedPlan) : null;
  const timeReduction = origTime && tunedTime
    ? Number((((origTime - tunedTime) / origTime) * 100).toFixed(1))
    : null;

  return (
    <div className="diff-container">
      <div className="section-header">
        <div>
          <h2 className="section-title">
            <Layers className="icon text-cyan" />
            <span>실행계획 Visual Diff & 튜닝 성과 비교</span>
          </h2>
          <p className="section-subtitle">
            SQL_ID: <strong>{item.sqlId}</strong> 쿼리의 튜닝 전/후 Execution Plan 및 메트릭 비교 화면입니다.
          </p>
        </div>
      </div>

      {/* 성과 하이라이트 카운터 카드 */}
      <div className="impact-summary-row">
        <div className="impact-card card-cost">
          <TrendingDown className="impact-icon text-cyan" />
          <div>
            <span className="impact-title">Optimizer Cost 감소율 (실행계획 파싱)</span>
            <span className="impact-value text-cyan">{costReduction !== null ? `-${costReduction}%` : '산출 불가'}</span>
            <span className="impact-sub">{isEstimated ? '예상 ' : ''}Cost: {origCost?.toLocaleString() ?? '-'} ➔ {tunedCost?.toLocaleString() ?? '-'}</span>
          </div>
        </div>

        <div className="impact-card card-time">
          <Clock className="impact-icon text-green" />
          <div>
            <span className="impact-title">소요시간 (실행계획 Time)</span>
            <span className="impact-value text-green">{timeReduction !== null ? `-${timeReduction}%` : '산출 불가'}</span>
            <span className="impact-sub">{origTime ?? '-'}초 ➔ {tunedTime ?? '-'}초{isEstimated ? ' (예상)' : ''}</span>
          </div>
        </div>

        <div className="impact-card card-io">
          <Database className="impact-icon text-amber" />
          <div>
            <span className="impact-title">Buffer Gets (튜닝 전)</span>
            <span className="impact-value text-amber">{item.bufferGets?.toLocaleString() ?? '-'}</span>
            <span className="impact-sub">튜닝 후 값은 실제 실행 후 실측이 필요합니다</span>
          </div>
        </div>
      </div>

      {/* SQL 비교 */}
      <div className="diff-grid">
        <div className="diff-box">
          <div className="diff-box-header header-before">
            <span className="badge-before">Original SQL</span>
            <span>튜닝 전 문장 (TABLE ACCESS FULL)</span>
          </div>
          <pre className="code-content">{item.sqlText}</pre>
        </div>

        <div className="diff-box">
          <div className="diff-box-header header-after">
            <span className="badge-after">Tuned SQL</span>
            <span>{item.tunedSql ? '힌트 주입 및 바인드 변수화 문장' : '진단 후 생성됩니다'}</span>
          </div>
          <pre className="code-content text-green-glow">{item.tunedSql || '아직 생성된 튜닝 SQL이 없습니다. SQL 진단 화면에서 진단을 실행해 주세요.'}</pre>
        </div>
      </div>

      {/* Execution Plan 비교 */}
      <div className="diff-grid margin-top-lg">
        <div className="diff-box">
          <div className="diff-box-header header-before">
            <span className="badge-before">Original Plan</span>
            <span>비효율적인 Execution Plan</span>
          </div>
          <pre className="code-content plan-code">{item.executionPlan}</pre>
        </div>

        <div className="diff-box">
          <div className="diff-box-header header-after">
            <span className="badge-after">Tuned Plan</span>
            <span>{item.tunedPlan ? '실행된 실제 계획' : isEstimated ? 'EXPLAIN PLAN 예상 계획 (실행하지 않음)' : 'EXPLAIN PLAN으로 확인 가능'}</span>
          </div>
          <pre className="code-content plan-code text-green-glow">{displayTunedPlan || '튜닝 후 실행계획은 아직 없습니다.\n아래 버튼을 누르면 튜닝 SQL을 실행하지 않고 EXPLAIN PLAN으로 예상 계획만 확인할 수 있습니다.'}</pre>

          {selectedSqlItem && item.tunedSql && !item.tunedPlan && (
            <div className="explain-actions">
              <button
                type="button"
                className="action-btn test-btn"
                onClick={handleExplain}
                disabled={!isConnected || isExplaining}
              >
                {isExplaining
                  ? <RefreshCw className="icon animate-spin" />
                  : <Eye className="icon text-cyan" />}
                <span>{isExplaining ? '예상 계획 생성 중...' : '실행 없이 예상 계획 보기 (EXPLAIN PLAN)'}</span>
              </button>
              {!isConnected && <span className="field-desc">DB 연결 후 사용할 수 있습니다.</span>}
              {explainError && (
                <span className="explain-error">
                  <AlertTriangle className="icon text-red" />
                  {explainError}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
