import type { TopSqlItem, OracleTuningQueryItem } from '../types/oracle';

export const MOCK_TOP_SQL_LIST: TopSqlItem[] = [
  {
    id: 'sql-1',
    sqlId: '9a8bc7def123',
    sqlText: `SELECT e.empno, e.ename, d.dname, e.sal
FROM emp e, dept d
WHERE e.deptno = d.deptno
  AND e.job = 'MANAGER'
  AND e.sal > 3000`,
    elapsedTimeSec: 28.45,
    cpuTimeSec: 18.20,
    userIoWaitSec: 10.25,
    bufferGets: 845200,
    diskReads: 32400,
    executions: 1420,
    dbTimePercentage: 34.2,
    normalizedSql: `SELECT e.empno, e.ename, d.dname, e.sal
FROM emp e, dept d
WHERE e.deptno = d.deptno
  AND e.job = :b1
  AND e.sal > :b2`,
    antiPatterns: [
      {
        type: 'FULL_TABLE_SCAN',
        title: 'Full Table Scan (EMP 테이블 인덱스 미사용)',
        detectedLogic: 'TABLE ACCESS FULL EMP 스캔으로 인해 845,200회 버퍼 조회가 발생함.',
        recommendation: 'EMP(JOB, SAL, DEPTNO) 결합 인덱스 생성 및 /*+ INDEX(e idx_emp_job_sal) */ 주입.',
        suggestedHints: ['/*+ INDEX(e idx_emp_job_sal) */'],
        severity: 'HIGH'
      },
      {
        type: 'PARSING_OVERHEAD',
        title: 'Hard Parsing & Literal 사용',
        detectedLogic: "e.job = 'MANAGER', e.sal > 3000 리터럴 값으로 인한 라이브러리 캐시 래치 경락 유발",
        recommendation: '리터럴 값을 바인드 변수로 변경하여 파싱 부하 차단.',
        suggestedHints: ['바인드 변수 (:b1, :b2) 적용'],
        severity: 'HIGH'
      }
    ],
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
-------------------------------------------------------------------------------------------------
Predicate Information (identified by operation id):
---------------------------------------------------
   1 - access("E"."DEPTNO"="D"."DEPTNO")
   2 - filter("E"."JOB"='MANAGER' AND "E"."SAL">3000)`,
    tunedPlan: `-------------------------------------------------------------------------------------------------
| Id  | Operation                   | Name            | Rows  | Bytes | Cost (%CPU)| Time     |
-------------------------------------------------------------------------------------------------
|   0 | SELECT STATEMENT            |                 |  1450 | 58000 |    12   (0)| 00:00:01 |
|   1 |  NESTED LOOPS               |                 |  1450 | 58000 |    12   (0)| 00:00:01 |
|   2 |   TABLE ACCESS BY INDEX ROWID| EMP             |   145 |  4350 |     8   (0)| 00:00:01 |
|*  3 |    INDEX RANGE SCAN         | IDX_EMP_JOB_SAL |   145 |     0 |     2   (0)| 00:00:01 |
|   4 |   TABLE ACCESS BY INDEX ROWID| DEPT            |     1 |    10 |     1   (0)| 00:00:01 |
|*  5 |    INDEX UNIQUE SCAN        | PK_DEPT         |     1 |     0 |     0   (0)| 00:00:01 |
-------------------------------------------------------------------------------------------------`
  },
  {
    id: 'sql-2',
    sqlId: '4f9da1bc8872',
    sqlText: `SELECT o.order_id, c.customer_name, o.total_amount
FROM orders o JOIN customers c ON o.customer_id = c.customer_id
WHERE o.order_date >= TO_DATE('2026-01-01', 'YYYY-MM-DD')
  AND c.region = 'SEOUL'`,
    elapsedTimeSec: 19.80,
    cpuTimeSec: 14.50,
    userIoWaitSec: 5.30,
    bufferGets: 612000,
    diskReads: 14500,
    executions: 980,
    dbTimePercentage: 23.8,
    normalizedSql: `SELECT o.order_id, c.customer_name, o.total_amount
FROM orders o JOIN customers c ON o.customer_id = c.customer_id
WHERE o.order_date >= :b1
  AND c.region = :b2`,
    antiPatterns: [
      {
        type: 'NL_JOIN_OVERUSE',
        title: 'NL Join 남용 (대용량 주문-고객 데이터 조인)',
        detectedLogic: '대용량 Orders 데이터와 Customers 조인 시 980,000회 이상의 Random Access를 발생시키는 NESTED LOOPS 조인 수행',
        recommendation: '메모리 기반 Hash Join으로 유도하기 위해 /*+ USE_HASH(o c) SWAP_JOIN_INPUTS(c) */ 주입.',
        suggestedHints: ['/*+ USE_HASH(o c) */', '/*+ SWAP_JOIN_INPUTS(c) */'],
        severity: 'HIGH'
      },
      {
        type: 'JOIN_ORDER_ERROR',
        title: 'Join Order 오류 (Driving Table 선택 오류)',
        detectedLogic: '비대해진 Orders 결과셋이 Driving Table이 되어 전체 조인 효율 저하',
        recommendation: '필터링 효과가 높은 Customers(c) 테이블을 Driving으로 변경하는 /*+ LEADING(c o) */ 힌트 적용.',
        suggestedHints: ['/*+ LEADING(c o) */'],
        severity: 'MEDIUM'
      }
    ],
    tunedSql: `SELECT /*+ LEADING(c o) USE_HASH(o) SWAP_JOIN_INPUTS(c) */ o.order_id, c.customer_name, o.total_amount
FROM orders o JOIN customers c ON o.customer_id = c.customer_id
WHERE o.order_date >= :b1
  AND c.region = :b2`,
    executionPlan: `-------------------------------------------------------------------------------------------------
| Id  | Operation                  | Name      | Rows  | Bytes | Cost (%CPU)| Time     |
-------------------------------------------------------------------------------------------------
|   0 | SELECT STATEMENT           |           | 85000 |3400000|  4500   (3)| 00:00:54 |
|   1 |  NESTED LOOPS              |           | 85000 |3400000|  4500   (3)| 00:00:54 |
|*  2 |   TABLE ACCESS FULL        | ORDERS    |120000 |2400000|  3200   (3)| 00:00:39 |
|*  3 |   TABLE ACCESS BY INDEX ROWID| CUSTOMERS |     1 |    20 |     2   (0)| 00:00:01 |
-------------------------------------------------------------------------------------------------`,
    tunedPlan: `-------------------------------------------------------------------------------------------------
| Id  | Operation                  | Name      | Rows  | Bytes | Cost (%CPU)| Time     |
-------------------------------------------------------------------------------------------------
|   0 | SELECT STATEMENT           |           | 85000 |3400000|   310   (1)| 00:00:04 |
|*  1 |  HASH JOIN                 |           | 85000 |3400000|   310   (1)| 00:00:04 |
|*  2 |   TABLE ACCESS FULL        | CUSTOMERS |  4200 | 84000 |    45   (0)| 00:00:01 |
|*  3 |   TABLE ACCESS BY INDEX ROWID| ORDERS    |120000 |2400000|   260   (1)| 00:00:03 |
-------------------------------------------------------------------------------------------------`
  },
  {
    id: 'sql-3',
    sqlId: '3x2cc912aa44',
    sqlText: `SELECT p.product_id, p.product_name, s.sale_qty
FROM products p, sales_fact s
WHERE p.product_id = s.product_id
  AND p.category_code = 'CAT_99'
  AND s.sale_date = TRUNC(SYSDATE)`,
    elapsedTimeSec: 15.30,
    cpuTimeSec: 11.80,
    userIoWaitSec: 3.50,
    bufferGets: 412000,
    diskReads: 8900,
    executions: 2400,
    dbTimePercentage: 18.5,
    normalizedSql: `SELECT p.product_id, p.product_name, s.sale_qty
FROM products p, sales_fact s
WHERE p.product_id = s.product_id
  AND p.category_code = :b1
  AND s.sale_date = :b2`,
    antiPatterns: [
      {
        type: 'CARDINALITY_MISMATCH',
        title: 'Cardinality 왜곡 (Data Skew 및 Bind Peeking 문제)',
        detectedLogic: '예측 E-Rows(10) 대비 실제 A-Rows(45,000) 현격한 보정 실패로 올바르지 않은 execution plan 채택',
        recommendation: 'OPT_ESTIMATE 힌트로 옵티마이저의 카디널리티 수치를 정밀 보정하거나 SQL Profile 주입.',
        suggestedHints: ['/*+ OPT_ESTIMATE(TABLE s ROWS=45000) */'],
        severity: 'HIGH'
      }
    ],
    tunedSql: `SELECT /*+ OPT_ESTIMATE(TABLE s ROWS=45000) LEADING(s p) USE_HASH(p) */ p.product_id, p.product_name, s.sale_qty
FROM products p, sales_fact s
WHERE p.product_id = s.product_id
  AND p.category_code = :b1
  AND s.sale_date = :b2`,
    executionPlan: `-------------------------------------------------------------------------------------------------
| Id  | Operation                  | Name       | Rows  | Bytes | Cost (%CPU)| Time     |
-------------------------------------------------------------------------------------------------
|   0 | SELECT STATEMENT           |            |    10 |   400 |   890   (2)| 00:00:11 |
|*  1 |  NESTED LOOPS              |            |    10 |   400 |   890   (2)| 00:00:11 |
|*  2 |   TABLE ACCESS FULL        | PRODUCTS   |    10 |   200 |    50   (0)| 00:00:01 |
|*  3 |   TABLE ACCESS FULL        | SALES_FACT |     1 |    20 |   840   (2)| 00:00:11 |
-------------------------------------------------------------------------------------------------`,
    tunedPlan: `-------------------------------------------------------------------------------------------------
| Id  | Operation                  | Name       | Rows  | Bytes | Cost (%CPU)| Time     |
-------------------------------------------------------------------------------------------------
|   0 | SELECT STATEMENT           |            | 45000 |1800000|    95   (1)| 00:00:02 |
|*  1 |  HASH JOIN                 |            | 45000 |1800000|    95   (1)| 00:00:02 |
|*  2 |   TABLE ACCESS BY INDEX ROWID| SALES_FACT | 45000 | 900000|    42   (0)| 00:00:01 |
|*  3 |   TABLE ACCESS FULL        | PRODUCTS   |   500 |  10000|    50   (0)| 00:00:01 |
-------------------------------------------------------------------------------------------------`
  }
];

export const ORACLE_TUNING_QUERIES: OracleTuningQueryItem[] = [
  {
    category: 'Top SQL 추출',
    title: 'v$sqlstats 기반 Top 10 High-Load SQL 조회',
    description: '전체 시스템 DB Time 및 CPU/I/O 소요시간 기준 상위 10개 쿼리와 SQL_ID를 실시간 추출합니다.',
    sqlText: `SELECT *
FROM (
    SELECT 
        sql_id,
        executions AS "수행횟수",
        ROUND(elapsed_time / 1000000, 2) AS "총_소요시간_초",
        ROUND(cpu_time / 1000000, 2) AS "총_CPU시간_초",
        ROUND(user_io_wait_time / 1000000, 2) AS "총_IO대기시간_초",
        buffer_gets AS "버퍼_조회수",
        disk_reads AS "디스크_읽기수",
        SUBSTR(sql_text, 1, 150) AS "SQL_텍스트_일부"
    FROM v$sqlstats
    ORDER BY elapsed_time DESC
)
WHERE ROWNUM <= 10;`
  },
  {
    category: '실행 계획 추출',
    title: 'DBMS_XPLAN 라이브 Execution Plan 추출',
    description: '메모리 라이브러리 캐시에 로드된 특정 SQL_ID의 실제 실행 계획(Allstats 포함)을 포맷팅하여 출력합니다.',
    sqlText: `SELECT * 
FROM TABLE(DBMS_XPLAN.DISPLAY_CURSOR('&SQL_ID', NULL, 'ALLSTATS LAST'));`
  },
  {
    category: 'SQL Profile & OPT_ESTIMATE',
    title: 'OPT_ESTIMATE를 활용한 SQL Profile 수동 생성 스크립트',
    description: '소스 코드 수정 없이 오라클 데이터 딕셔너리에 OPT_ESTIMATE 힌트를 직접 주입하여 카디널리티 계산을 교정합니다.',
    sqlText: `BEGIN
  DBMS_SQLTUNE.IMPORT_SQL_PROFILE(
    sql_text    => 'SELECT e.empno FROM emp e WHERE e.deptno = :b1',
    profile     => sqlprof_attr('OPT_ESTIMATE(TABLE e ROWS=50000)'),
    name        => 'PROFILE_EMP_DEPT_OPT_EST',
    replace     => TRUE,
    force_match => TRUE
  );
END;
/`
  },
  {
    category: 'Library Cache & Hard Parsing',
    title: '하드 파싱 및 바인드 변수 미사용 쿼리 탐지',
    description: '동일한 문장 구조를 가졌으나 바인드 변수를 타지 않아 라이브러리 캐시 래치를 독점하는 쿼리를 식별합니다.',
    sqlText: `SELECT 
    force_matching_signature,
    COUNT(*) AS "파싱_변종_개수",
    SUM(executions) AS "총_수행횟수",
    MAX(sql_id) AS "대표_SQL_ID",
    SUBSTR(MAX(sql_text), 1, 100) AS "대표_SQL_텍스트"
FROM v$sqlarea
WHERE force_matching_signature <> 0
GROUP BY force_matching_signature
HAVING COUNT(*) > 10
ORDER BY 2 DESC;`
  },
  {
    category: 'DRCP & 네트워크 최적화',
    title: 'DRCP (Database Resident Connection Pooling) 상태 모니터링',
    description: '웹 애플리케이션의 수천 개 동시 커넥션 부하를 유연하게 처리하는 DRCP 풀 사용량을 모니터링합니다.',
    sqlText: `SELECT 
    pool_name, 
    num_open_servers, 
    num_active_servers, 
    num_busy_buffers,
    num_hits, 
    num_misses
FROM v$cpool_cc_stats;`
  },
  {
    category: 'AWR / ADDM 백그라운드 분석',
    title: 'DB Time 절감율 계량화용 AWR 스냅샷 생성',
    description: '튜닝 전/후의 시스템 전체 Total DB Time 변화를 정밀 계량화하기 위한 AWR Snapshot을 수동 생성합니다.',
    sqlText: `-- 튜닝 전 스냅샷 생성
EXEC DBMS_WORKLOAD_REPOSITORY.CREATE_SNAPSHOT();

-- (튜닝 작업 수행 및 일정 기간 대기)

-- 튜닝 후 스냅샷 생성 및 리포트 조회
SELECT * FROM TABLE(DBMS_WORKLOAD_REPOSITORY.AWR_REPORT_TEXT(
    l_dbid       => (SELECT dbid FROM v$database),
    l_inst_num   => 1,
    l_bid        => &START_SNAP_ID,
    l_eid        => &END_SNAP_ID
));`
  }
];
