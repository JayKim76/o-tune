import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildConnectString,
  calculateBufferCacheHitRatio,
  clampLimit,
  mapTopSqlRows,
  sanitizeOracleError,
  validateConnectionConfig,
} from '../server/oracleData.mjs';

const baseConfig = {
  host: '192.168.1.100',
  port: 1521,
  serviceName: 'ORCL',
  username: 'SYSTEM',
  password: 'secret',
  useDrcp: false,
};

test('연결 설정을 검증하고 정규화한다', () => {
  const config = validateConnectionConfig({ ...baseConfig, host: ' db.example.com ' });
  assert.equal(config.host, 'db.example.com');
  assert.equal(config.port, 1521);
  assert.equal(config.useDrcp, false);
});

test('잘못된 포트와 비밀번호 누락을 거부한다', () => {
  assert.throws(() => validateConnectionConfig({ ...baseConfig, port: 70000 }), /포트/);
  assert.throws(() => validateConnectionConfig({ ...baseConfig, password: '' }), /비밀번호/);
  assert.throws(() => validateConnectionConfig({ ...baseConfig, host: 'bad host/name' }), /호스트/);
});

test('DRCP 여부에 따라 Easy Connect 문자열이 달라진다', () => {
  assert.equal(buildConnectString(baseConfig), '192.168.1.100:1521/ORCL');
  assert.equal(buildConnectString({ ...baseConfig, useDrcp: true }), '192.168.1.100:1521/ORCL:POOLED');
});

test('limit은 1~20 범위로 제한한다', () => {
  assert.equal(clampLimit(0), 1);
  assert.equal(clampLimit(99), 20);
  assert.equal(clampLimit('abc'), 10);
});

test('Top SQL 행의 마이크로초와 DB Time 비중을 변환한다', () => {
  const items = mapTopSqlRows([
    {
      sqlId: 'abc', sqlText: 'SELECT 1 FROM dual',
      elapsedTimeMicro: 3_000_000, cpuTimeMicro: 1_000_000, userIoWaitTimeMicro: 500_000,
      bufferGets: 100, diskReads: 3, executions: 2, totalElapsedTimeMicro: 4_000_000,
      executionPlan: 'PLAN',
    },
    {
      sqlId: 'def', sqlText: 'SELECT 2 FROM dual',
      elapsedTimeMicro: 1_000_000, cpuTimeMicro: 250_000, userIoWaitTimeMicro: 0,
      bufferGets: 10, diskReads: 1, executions: 1, totalElapsedTimeMicro: 4_000_000,
    },
  ]);
  assert.equal(items[0].elapsedTimeSec, 3);
  assert.equal(items[0].dbTimePercentage, 75);
  assert.equal(items[1].dbTimePercentage, 25);
  assert.equal(items[0].executionPlan, 'PLAN');
});

test('버퍼 캐시 히트율을 Oracle 공식으로 계산한다', () => {
  const ratio = calculateBufferCacheHitRatio([
    { name: 'physical reads cache', value: 50 },
    { name: 'consistent gets from cache', value: 700 },
    { name: 'db block gets from cache', value: 300 },
  ]);
  assert.equal(ratio, 95);
  assert.equal(calculateBufferCacheHitRatio([]), null);
});

test('오류 메시지에서 비밀번호 패턴을 숨긴다', () => {
  const message = sanitizeOracleError(new Error('connect failed password: secret ORA-01017'));
  assert.equal(message.includes('secret'), false);
  assert.match(message, /ORA-01017/);
});
