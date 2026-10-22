import React from 'react';
import type { TopSqlItem } from '../types/oracle';
import { parsePlanCost, parsePlanTimeSec } from '../utils/sqlParser';
import { Layers, TrendingDown, Clock, Database } from 'lucide-react';

interface PlanDiffViewerProps {
  selectedSqlItem?: TopSqlItem | null;
}

export const PlanDiffViewer: React.FC<PlanDiffViewerProps> = ({ selectedSqlItem }) => {
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
|*  3 |    INDEX RANGE SCAN         | IDX_EMP_JOB_SAL |   145 |     0 |     2   (0)| 00:00:01 |
|   4 |   TABLE ACCESS BY INDEX ROWID| DEPT            |     1 |    10 |     1   (0)| 00:00:01 |
|*  5 |    INDEX UNIQUE SCAN        | PK_DEPT         |     1 |     0 |     0   (0)| 00:00:01 |
-------------------------------------------------------------------------------------------------`,
    elapsedTimeSec: 28.45,
    bufferGets: 845200
  };

  // 성과 수치는 고정값이 아니라 선택된 SQL의 실행계획에서 직접 파싱해 계산한다.
  const origCost = parsePlanCost(item.executionPlan);
  const tunedCost = item.tunedPlan ? parsePlanCost(item.tunedPlan) : null;
  const costReduction = origCost && tunedCost
    ? Number((((origCost - tunedCost) / origCost) * 100).toFixed(1))
    : null;
  const origTime = parsePlanTimeSec(item.executionPlan);
  const tunedTime = item.tunedPlan ? parsePlanTimeSec(item.tunedPlan) : null;
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
            <span className="impact-sub">Cost: {origCost?.toLocaleString() ?? '-'} ➔ {tunedCost?.toLocaleString() ?? '-'}</span>
          </div>
        </div>

        <div className="impact-card card-time">
          <Clock className="impact-icon text-green" />
          <div>
            <span className="impact-title">소요시간 (실행계획 Time)</span>
            <span className="impact-value text-green">{timeReduction !== null ? `-${timeReduction}%` : '산출 불가'}</span>
            <span className="impact-sub">{origTime ?? '-'}초 ➔ {tunedTime ?? '-'}초</span>
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
            <span>힌트 주입 및 바인드 변수화 문장</span>
          </div>
          <pre className="code-content text-green-glow">{item.tunedSql || item.sqlText}</pre>
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
            <span>인덱스 스캔 및 비용 교정 Plan</span>
          </div>
          <pre className="code-content plan-code text-green-glow">{item.tunedPlan || item.executionPlan}</pre>
        </div>
      </div>
    </div>
  );
};
