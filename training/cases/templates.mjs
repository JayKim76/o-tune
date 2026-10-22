// 합성 튜닝 케이스 템플릿 10종 × 변형 10개 = 100건.
// 결정적(deterministic) 생성: 같은 코드에서는 항상 같은 케이스가 나온다.
// 지표는 비용 모델 기반 추정치이며(metrics_basis: "estimated"),
// 샌드박스 실측 검증을 거치기 전까지 review.verdict는 "pending"이다.

// 간단한 결정적 난수 (mulberry32)
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SIZE_MULTIPLIERS = [0.8, 1, 1.3, 1.7, 2.2, 2.8, 3.5, 4.4, 5.5, 7];

function timeText(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `00:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function planText(rows) {
  const line = '-'.repeat(97);
  const body = rows.map((r) => `| ${r} |`).join('\n');
  return `${line}\n| Id  | Operation                  | Name        | Rows  | Bytes | Cost (%CPU)| Time     |\n${line}\n${body}\n${line}`;
}

function metricsFrom(baseBg, mult, jitter, factors, rand) {
  const bg = Math.round(baseBg * mult * (0.9 + jitter * 0.2));
  const cost = Math.max(2, Math.round(bg / 640));
  const elapsed = Number((bg / 29700 * (0.9 + rand() * 0.2)).toFixed(2));
  const goldBg = Math.max(10, Math.round(bg * factors.bg));
  const goldCost = Math.max(1, Math.round(cost * factors.cost));
  const goldElapsed = Number(Math.max(0.05, elapsed * factors.time).toFixed(2));
  return {
    original: {
      elapsed_sec: elapsed, buffer_gets: bg, disk_reads: Math.round(bg * 0.04),
      executions: 100 + Math.floor(rand() * 4900), cost,
    },
    gold: {
      elapsed_sec: goldElapsed, buffer_gets: goldBg,
      disk_reads: Math.round(goldBg * 0.02), executions: 0, cost: goldCost,
    },
  };
}

const TEMPLATES = [
  {
    key: 'hr_fullscan_literal', family: 'HR', patterns: ['FULL_TABLE_SCAN', 'PARSING_OVERHEAD'],
    factors: { bg: 0.03, cost: 0.02, time: 0.05 }, baseBg: 820000,
    build(v) {
      const jobs = ['MANAGER', 'IT_PROG', 'SA_REP', 'ST_CLERK', 'AD_VP'];
      const job = jobs[v % jobs.length];
      const sal = 3000 + v * 250;
      return {
        ddl: 'CREATE TABLE employees (employee_id NUMBER PRIMARY KEY, first_name VARCHAR2(50), job_id VARCHAR2(20), salary NUMBER, department_id NUMBER);\nCREATE TABLE departments (department_id NUMBER PRIMARY KEY, department_name VARCHAR2(50));',
        originalSql: `SELECT e.employee_id, e.first_name, d.department_name, e.salary\nFROM employees e, departments d\nWHERE e.department_id = d.department_id\n  AND e.job_id = '${job}'\n  AND e.salary > ${sal}`,
        goldSql: `SELECT /*+ INDEX(e idx_emp_job_sal) */ e.employee_id, e.first_name, d.department_name, e.salary\nFROM employees e, departments d\nWHERE e.department_id = d.department_id\n  AND e.job_id = :b1\n  AND e.salary > :b2`,
        hints: ['/*+ INDEX(e idx_emp_job_sal) */'],
        risk: '결합 인덱스 신규 생성 시 INSERT/UPDATE 부하 증가 가능. 기존 인덱스와 중복 여부 확인 필요.',
        planRows: (cost, sec) => [
          `  0 | SELECT STATEMENT           |             |  1450 | 58000 | ${cost} (2)| ${timeText(sec)} `,
          ` *1 |  HASH JOIN                 |             |  1450 | 58000 | ${cost} (2)| ${timeText(sec)} `,
          ` *2 |   TABLE ACCESS FULL        | EMPLOYEES   | 14500 |435000 | ${Math.round(cost * 0.9)} (2)| ${timeText(sec * 0.9)} `,
          `  3 |   TABLE ACCESS FULL        | DEPARTMENTS |     4 |    40 |     3 (0)| 00:00:01 `,
        ],
      };
    },
  },
  {
    key: 'sales_nl_misuse', family: 'SALES', patterns: ['NL_JOIN_OVERUSE'],
    factors: { bg: 0.12, cost: 0.08, time: 0.15 }, baseBg: 610000,
    build(v) {
      const regions = ['SEOUL', 'BUSAN', 'INCHEON', 'DAEGU', 'GWANGJU'];
      const region = regions[v % regions.length];
      const year = 2024 + (v % 3);
      return {
        ddl: 'CREATE TABLE orders (order_id NUMBER PRIMARY KEY, customer_id NUMBER, order_date DATE, total_amount NUMBER);\nCREATE TABLE customers (customer_id NUMBER PRIMARY KEY, customer_name VARCHAR2(80), region VARCHAR2(30));\nCREATE INDEX idx_orders_cust ON orders(customer_id);',
        originalSql: `SELECT o.order_id, c.customer_name, o.total_amount\nFROM orders o JOIN customers c ON o.customer_id = c.customer_id\nWHERE o.order_date >= TO_DATE('${year}-01-01', 'YYYY-MM-DD')\n  AND c.region = '${region}'`,
        goldSql: `SELECT /*+ LEADING(c o) USE_HASH(o) */ o.order_id, c.customer_name, o.total_amount\nFROM orders o JOIN customers c ON o.customer_id = c.customer_id\nWHERE o.order_date >= :b1\n  AND c.region = :b2`,
        hints: ['/*+ LEADING(c o) USE_HASH(o) */'],
        risk: '해시 조인은 PGA 사용량이 늘 수 있어 동시 실행 수와 PGA 여유를 확인해야 한다.',
        planRows: (cost, sec) => [
          `  0 | SELECT STATEMENT           |             | 85000 |3400000| ${cost} (3)| ${timeText(sec)} `,
          `  1 |  NESTED LOOPS              |             | 85000 |3400000| ${cost} (3)| ${timeText(sec)} `,
          ` *2 |   TABLE ACCESS FULL        | ORDERS      |120000 |2400000| ${Math.round(cost * 0.7)} (3)| ${timeText(sec * 0.7)} `,
          ` *3 |   TABLE ACCESS BY INDEX ROWID| CUSTOMERS |     1 |    20 |     2 (0)| 00:00:01 `,
        ],
      };
    },
  },
  {
    key: 'retail_cardinality_skew', family: 'RETAIL', patterns: ['CARDINALITY_MISMATCH'],
    factors: { bg: 0.15, cost: 0.12, time: 0.2 }, baseBg: 430000,
    build(v) {
      const cat = `CAT_${10 + v}`;
      return {
        ddl: 'CREATE TABLE products (product_id NUMBER PRIMARY KEY, product_name VARCHAR2(100), category_code VARCHAR2(20));\nCREATE TABLE sales_fact (product_id NUMBER, sale_qty NUMBER, sale_date DATE);',
        originalSql: `SELECT p.product_id, p.product_name, s.sale_qty\nFROM products p, sales_fact s\nWHERE p.product_id = s.product_id\n  AND p.category_code = '${cat}'\n  AND s.sale_date = TRUNC(SYSDATE)`,
        goldSql: `SELECT /*+ OPT_ESTIMATE(TABLE s ROWS=45000) LEADING(s p) USE_HASH(p) */ p.product_id, p.product_name, s.sale_qty\nFROM products p, sales_fact s\nWHERE p.product_id = s.product_id\n  AND p.category_code = :b1\n  AND s.sale_date = :b2`,
        hints: ['/*+ OPT_ESTIMATE(TABLE s ROWS=45000) */', '/*+ USE_HASH(p) */'],
        risk: 'OPT_ESTIMATE 보정값은 데이터 분포가 바뀌면 어긋날 수 있어 통계 수집 주기와 함께 관리해야 한다.',
        planRows: (cost, sec) => [
          `  0 | SELECT STATEMENT           |             |    10 |   400 | ${cost} (2)| ${timeText(sec)} `,
          `  1 |  NESTED LOOPS              |             |    10 |   400 | ${cost} (2)| ${timeText(sec)} `,
          ` *2 |   TABLE ACCESS FULL        | PRODUCTS    |    10 |   200 |    50 (0)| 00:00:01 `,
          ` *3 |   TABLE ACCESS FULL        | SALES_FACT  |     1 |    20 | ${Math.round(cost * 0.95)} (2)| ${timeText(sec)} `,
          'Note: E-Rows(10)와 실제 A-Rows(45000)의 괴리가 큰 스큐 케이스',
        ],
      };
    },
  },
  {
    key: 'fin_fullscan_date', family: 'FINANCE', patterns: ['FULL_TABLE_SCAN', 'PARSING_OVERHEAD'],
    factors: { bg: 0.05, cost: 0.04, time: 0.08 }, baseBg: 980000,
    build(v) {
      const month = String((v % 12) + 1).padStart(2, '0');
      const statuses = ['DONE', 'PENDING', 'FAILED'];
      const status = statuses[v % statuses.length];
      return {
        ddl: 'CREATE TABLE transactions (txn_id NUMBER PRIMARY KEY, account_id NUMBER, txn_date DATE, amount NUMBER, status VARCHAR2(20));\nCREATE TABLE accounts (account_id NUMBER PRIMARY KEY, owner_name VARCHAR2(80));\nCREATE INDEX idx_txn_date ON transactions(txn_date);',
        originalSql: `SELECT t.txn_id, a.owner_name, t.amount\nFROM transactions t, accounts a\nWHERE t.account_id = a.account_id\n  AND t.txn_date >= TO_DATE('2026-${month}-01', 'YYYY-MM-DD')\n  AND t.status = '${status}'`,
        goldSql: `SELECT /*+ INDEX(t idx_txn_date) */ t.txn_id, a.owner_name, t.amount\nFROM transactions t, accounts a\nWHERE t.account_id = a.account_id\n  AND t.txn_date >= :b1\n  AND t.status = :b2`,
        hints: ['/*+ INDEX(t idx_txn_date) */'],
        risk: '날짜 범위 선택도가 낮은 구간에서는 인덱스보다 풀스캔이 나을 수 있어 구간별 검증이 필요하다.',
        planRows: (cost, sec) => [
          `  0 | SELECT STATEMENT           |             | 32000 |1280000| ${cost} (2)| ${timeText(sec)} `,
          ` *1 |  HASH JOIN                 |             | 32000 |1280000| ${cost} (2)| ${timeText(sec)} `,
          ` *2 |   TABLE ACCESS FULL        | TRANSACTIONS|540000 |10800000| ${Math.round(cost * 0.92)} (2)| ${timeText(sec * 0.9)} `,
          `  3 |   TABLE ACCESS FULL        | ACCOUNTS    |  9000 | 180000 |    40 (0)| 00:00:02 `,
        ],
      };
    },
  },
  {
    key: 'logi_join_order', family: 'LOGISTICS', patterns: ['JOIN_ORDER_ERROR'],
    factors: { bg: 0.2, cost: 0.18, time: 0.25 }, baseBg: 380000,
    build(v) {
      const codes = ['AIR', 'SEA', 'RAIL', 'TRUCK'];
      const code = codes[v % codes.length];
      return {
        ddl: 'CREATE TABLE shipments (shipment_id NUMBER PRIMARY KEY, carrier_id NUMBER, ship_date DATE, weight NUMBER);\nCREATE TABLE carriers (carrier_id NUMBER PRIMARY KEY, carrier_name VARCHAR2(60), ship_mode VARCHAR2(10));\nCREATE INDEX idx_ship_carrier ON shipments(carrier_id);',
        originalSql: `SELECT s.shipment_id, c.carrier_name, s.weight\nFROM shipments s, carriers c\nWHERE s.carrier_id = c.carrier_id\n  AND c.ship_mode = '${code}'`,
        goldSql: `SELECT /*+ LEADING(c s) USE_NL(s) */ s.shipment_id, c.carrier_name, s.weight\nFROM shipments s, carriers c\nWHERE s.carrier_id = c.carrier_id\n  AND c.ship_mode = :b1`,
        hints: ['/*+ LEADING(c s) USE_NL(s) */'],
        risk: '작은 테이블 드라이빙은 해당 테이블의 선택도가 유지될 때만 유효하다.',
        planRows: (cost, sec) => [
          `  0 | SELECT STATEMENT           |             | 60000 |1800000| ${cost} (2)| ${timeText(sec)} `,
          `  1 |  HASH JOIN                 |             | 60000 |1800000| ${cost} (2)| ${timeText(sec)} `,
          `  2 |   TABLE ACCESS FULL        | SHIPMENTS   |300000 |6000000| ${Math.round(cost * 0.8)} (2)| ${timeText(sec * 0.8)} `,
          ` *3 |   TABLE ACCESS FULL        | CARRIERS    |    12 |   240 |     3 (0)| 00:00:01 `,
        ],
      };
    },
  },
  {
    key: 'hr_parsing_inlist', family: 'HR', patterns: ['PARSING_OVERHEAD'],
    factors: { bg: 0.97, cost: 1.0, time: 0.82 }, baseBg: 120000,
    build(v) {
      const deptBase = 10 + (v % 5) * 10;
      return {
        ddl: 'CREATE TABLE employees (employee_id NUMBER PRIMARY KEY, first_name VARCHAR2(50), job_id VARCHAR2(20), salary NUMBER, department_id NUMBER);\nCREATE INDEX idx_emp_dept ON employees(department_id);',
        originalSql: `SELECT employee_id, first_name, salary\nFROM employees\nWHERE job_id IN ('IT_PROG', 'SA_REP', 'ST_CLERK')\n  AND department_id IN (${deptBase}, ${deptBase + 10}, ${deptBase + 20})\n  AND salary > ${2500 + v * 100}`,
        goldSql: `SELECT employee_id, first_name, salary\nFROM employees\nWHERE job_id IN (:b1, :b2, :b3)\n  AND department_id IN (:b4, :b5, :b6)\n  AND salary > :b7`,
        hints: [],
        risk: '바인드 변수화 시 실행계획 공유로 피킹(peeking) 영향이 생길 수 있어 바인드 민감도를 확인한다.',
        planRows: (cost, sec) => [
          `  0 | SELECT STATEMENT           |             |   320 | 12800 | ${cost} (1)| ${timeText(sec)} `,
          ` *1 |  TABLE ACCESS BY INDEX ROWID| EMPLOYEES  |   320 | 12800 | ${cost} (1)| ${timeText(sec)} `,
          ` *2 |   INDEX RANGE SCAN         | IDX_EMP_DEPT|   900 |       |    12 (0)| 00:00:01 `,
          'Note: 액세스 경로는 정상이나 리터럴 조합마다 하드 파싱이 반복되는 케이스',
        ],
      };
    },
  },
  {
    key: 'inv_composite_index', family: 'INVENTORY', patterns: ['FULL_TABLE_SCAN'],
    factors: { bg: 0.04, cost: 0.03, time: 0.06 }, baseBg: 720000,
    build(v) {
      const wh = 100 + v;
      const prod = 5000 + v * 37;
      return {
        ddl: 'CREATE TABLE inventory (warehouse_id NUMBER, product_id NUMBER, qty_on_hand NUMBER, PRIMARY KEY (warehouse_id, product_id));\nCREATE TABLE warehouses (warehouse_id NUMBER PRIMARY KEY, warehouse_name VARCHAR2(60));',
        originalSql: `SELECT i.qty_on_hand, w.warehouse_name\nFROM inventory i, warehouses w\nWHERE i.warehouse_id = w.warehouse_id\n  AND i.warehouse_id = ${wh}\n  AND i.product_id = ${prod}`,
        goldSql: `SELECT /*+ INDEX(i SYS_C_INDEX) */ i.qty_on_hand, w.warehouse_name\nFROM inventory i, warehouses w\nWHERE i.warehouse_id = w.warehouse_id\n  AND i.warehouse_id = :b1\n  AND i.product_id = :b2`,
        hints: ['/*+ INDEX(i SYS_C_INDEX) */'],
        risk: '힌트의 인덱스명은 환경마다 달라 실제 인덱스명으로 교체해 적용해야 한다.',
        planRows: (cost, sec) => [
          `  0 | SELECT STATEMENT           |             |     1 |    40 | ${cost} (2)| ${timeText(sec)} `,
          `  1 |  NESTED LOOPS              |             |     1 |    40 | ${cost} (2)| ${timeText(sec)} `,
          ` *2 |   TABLE ACCESS FULL        | INVENTORY   |900000 |18000000| ${Math.round(cost * 0.97)} (2)| ${timeText(sec)} `,
          ` *3 |   TABLE ACCESS BY INDEX ROWID| WAREHOUSES|     1 |    20 |     1 (0)| 00:00:01 `,
        ],
      };
    },
  },
  {
    key: 'commerce_cartesian', family: 'COMMERCE', patterns: ['JOIN_ORDER_ERROR'],
    factors: { bg: 0.08, cost: 0.06, time: 0.1 }, baseBg: 890000,
    build(v) {
      const minPrice = 10000 + v * 1000;
      return {
        ddl: 'CREATE TABLE order_items (order_id NUMBER, product_id NUMBER, qty NUMBER, price NUMBER);\nCREATE TABLE products (product_id NUMBER PRIMARY KEY, product_name VARCHAR2(100), price NUMBER);',
        originalSql: `SELECT oi.order_id, p.product_name, oi.qty\nFROM order_items oi, products p\nWHERE oi.price > ${minPrice}`,
        goldSql: `SELECT /*+ USE_HASH(p) */ oi.order_id, p.product_name, oi.qty\nFROM order_items oi, products p\nWHERE oi.product_id = p.product_id\n  AND oi.price > :b1`,
        hints: ['/*+ USE_HASH(p) */'],
        risk: '조인 조건 누락 수정은 결과 집합 자체를 바꾸므로 업무 검증(건수 대조)이 반드시 선행돼야 한다.',
        planRows: (cost, sec) => [
          `  0 | SELECT STATEMENT           |             |2400000|72000000| ${cost} (4)| ${timeText(sec)} `,
          `  1 |  MERGE JOIN CARTESIAN      |             |2400000|72000000| ${cost} (4)| ${timeText(sec)} `,
          ` *2 |   TABLE ACCESS FULL        | ORDER_ITEMS | 80000 |1600000| ${Math.round(cost * 0.4)} (2)| ${timeText(sec * 0.4)} `,
          `  3 |   BUFFER SORT              |             |   300 |  9000 | ${Math.round(cost * 0.5)} (2)| ${timeText(sec * 0.5)} `,
        ],
      };
    },
  },
  {
    key: 'insurance_nl_batch', family: 'INSURANCE', patterns: ['NL_JOIN_OVERUSE'],
    factors: { bg: 0.1, cost: 0.09, time: 0.12 }, baseBg: 660000,
    build(v) {
      const types = ['AUTO', 'FIRE', 'LIFE', 'HEALTH'];
      const type = types[v % types.length];
      return {
        ddl: 'CREATE TABLE claims (claim_id NUMBER PRIMARY KEY, member_id NUMBER, claim_type VARCHAR2(20), claim_amount NUMBER, claim_date DATE);\nCREATE TABLE members (member_id NUMBER PRIMARY KEY, member_name VARCHAR2(80), grade VARCHAR2(10));\nCREATE INDEX idx_claims_member ON claims(member_id);',
        originalSql: `SELECT c.claim_id, m.member_name, c.claim_amount\nFROM claims c, members m\nWHERE c.member_id = m.member_id\n  AND c.claim_type = '${type}'\n  AND c.claim_date >= SYSDATE - ${90 + v * 10}`,
        goldSql: `SELECT /*+ LEADING(m c) USE_HASH(c) */ c.claim_id, m.member_name, c.claim_amount\nFROM claims c, members m\nWHERE c.member_id = m.member_id\n  AND c.claim_type = :b1\n  AND c.claim_date >= :b2`,
        hints: ['/*+ LEADING(m c) USE_HASH(c) */'],
        risk: '배치성 조회는 해시 조인이 유리하지만 피크 시간대 PGA 경합을 확인해야 한다.',
        planRows: (cost, sec) => [
          `  0 | SELECT STATEMENT           |             | 45000 |1800000| ${cost} (3)| ${timeText(sec)} `,
          `  1 |  NESTED LOOPS              |             | 45000 |1800000| ${cost} (3)| ${timeText(sec)} `,
          ` *2 |   TABLE ACCESS FULL        | CLAIMS      |400000 |12000000| ${Math.round(cost * 0.75)} (3)| ${timeText(sec * 0.75)} `,
          ` *3 |   TABLE ACCESS BY INDEX ROWID| MEMBERS   |     1 |    30 |     2 (0)| 00:00:01 `,
        ],
      };
    },
  },
  {
    key: 'hotel_groupby_scan', family: 'HOSPITALITY', patterns: ['FULL_TABLE_SCAN'],
    factors: { bg: 0.18, cost: 0.15, time: 0.22 }, baseBg: 540000,
    build(v) {
      const year = 2024 + (v % 3);
      return {
        ddl: 'CREATE TABLE reservations (reservation_id NUMBER PRIMARY KEY, hotel_id NUMBER, checkin_date DATE, amount NUMBER, status VARCHAR2(20));\nCREATE TABLE hotels (hotel_id NUMBER PRIMARY KEY, hotel_name VARCHAR2(80), city VARCHAR2(40));\nCREATE INDEX idx_res_hotel_date ON reservations(hotel_id, checkin_date);',
        originalSql: `SELECT h.hotel_name, COUNT(*) AS cnt, SUM(r.amount) AS total\nFROM reservations r, hotels h\nWHERE r.hotel_id = h.hotel_id\n  AND r.checkin_date >= TO_DATE('${year}-01-01', 'YYYY-MM-DD')\n  AND r.status = 'CONFIRMED'\nGROUP BY h.hotel_name`,
        goldSql: `SELECT /*+ INDEX(r idx_res_hotel_date) */ h.hotel_name, COUNT(*) AS cnt, SUM(r.amount) AS total\nFROM reservations r, hotels h\nWHERE r.hotel_id = h.hotel_id\n  AND r.checkin_date >= :b1\n  AND r.status = :b2\nGROUP BY h.hotel_name`,
        hints: ['/*+ INDEX(r idx_res_hotel_date) */'],
        risk: '집계 쿼리는 인덱스 경유가 항상 유리하지 않아 기간 범위별 검증이 필요하다.',
        planRows: (cost, sec) => [
          `  0 | SELECT STATEMENT           |             |   120 |  6000 | ${cost} (3)| ${timeText(sec)} `,
          `  1 |  HASH GROUP BY             |             |   120 |  6000 | ${Math.round(cost * 0.9)} (3)| ${timeText(sec * 0.9)} `,
          ` *2 |   HASH JOIN                |             |200000 |8000000| ${Math.round(cost * 0.85)} (3)| ${timeText(sec * 0.85)} `,
          ` *3 |    TABLE ACCESS FULL       | RESERVATIONS|600000 |18000000| ${Math.round(cost * 0.7)} (3)| ${timeText(sec * 0.7)} `,
        ],
      };
    },
  },
];

export function buildCases() {
  const cases = [];
  let seq = 0;
  for (let t = 0; t < TEMPLATES.length; t += 1) {
    const template = TEMPLATES[t];
    for (let v = 0; v < 10; v += 1) {
      seq += 1;
      const rand = rng(1000 + t * 100 + v);
      const built = template.build(v);
      const m = metricsFrom(template.baseBg, SIZE_MULTIPLIERS[v], rand(), template.factors, rand);
      const caseId = `case-${String(seq).padStart(4, '0')}`;
      cases.push({
        case_id: caseId,
        source: 'synthetic',
        pattern: template.key,
        family: template.family,
        schema_ddl: built.ddl,
        stats_snapshot_id: `snap-${template.key}`,
        original_sql: built.originalSql,
        original_plan: planText(built.planRows(m.original.cost, m.original.elapsed_sec)),
        original_metrics: m.original,
        gold_tuned_sql: built.goldSql,
        gold_metrics: { ...m.gold, executions: m.original.executions },
        diagnosis: {
          anti_patterns: template.patterns,
          recommended_hints: built.hints,
          risk_notes: built.risk,
        },
        metrics_basis: 'estimated',
        orig_result_hash: null,
        review: { reviewer: 'generator', verdict: 'pending', reviewed_at: null },
      });
    }
  }
  return cases;
}
