import React, { useState } from 'react';
import type { OracleConnectionConfig, OracleConnectionTestResult } from '../types/oracle';
import { testOracleConnection } from '../utils/oracleBackendApi';
import { Database, Server, User, CheckCircle2, X, Activity, RefreshCw, Lock, AlertTriangle, KeyRound } from 'lucide-react';

interface DbConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: OracleConnectionConfig;
  onSaveConfig: (newConfig: OracleConnectionConfig) => void;
}

export const DbConnectionModal: React.FC<DbConnectionModalProps> = ({
  isOpen,
  onClose,
  config,
  onSaveConfig
}) => {
  const [formData, setFormData] = useState<OracleConnectionConfig>({ ...config });
  const [testing, setTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  // 모달이 열릴 때마다 바깥(App)의 최신 연결 설정을 폼에 반영한다.
  const [wasOpen, setWasOpen] = useState<boolean>(false);
  if (isOpen && !wasOpen) {
    setWasOpen(true);
    setFormData({ ...config });
    setTestResult(null);
  } else if (!isOpen && wasOpen) {
    setWasOpen(false);
  }

  if (!isOpen) return null;

  const runTest = async (): Promise<OracleConnectionTestResult | null> => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testOracleConnection(formData);
      setTestResult({
        kind: 'success',
        message: `연결 성공 · 응답 ${result.latencyMs}ms · DB ${result.databaseName || '-'} · Oracle ${result.version || '버전 미확인'} · 사용자 ${result.currentUser || formData.username}`,
      });
      return result;
    } catch (error) {
      setTestResult({
        kind: 'error',
        message: error instanceof Error ? error.message : '연결 테스트에 실패했습니다.',
      });
      return null;
    } finally {
      setTesting(false);
    }
  };

  const handleTestConnection = async () => {
    await runTest();
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await runTest();
    if (!result) return;
    onSaveConfig({
      ...formData,
      status: 'CONNECTED',
      lastConnectedAt: new Date().toLocaleTimeString()
    });
    onClose();
  };

  const tnsString = `${formData.serviceName.toUpperCase()}_DB =
  (DESCRIPTION =
    ${formData.useDrcp ? '(SERVER = POOLED)' : ''}
    (ADDRESS = (PROTOCOL = TCP)(HOST = ${formData.host || '192.168.1.100'})(PORT = ${formData.port || 1521}))
    (CONNECT_DATA = (SERVICE_NAME = ${formData.serviceName || 'ORCL'}))
  )`;

  return (
    <div className="modal-overlay">
      <div className="modal-card animate-fade-in">
        <div className="modal-header">
          <div className="modal-title-wrap">
            <Database className="icon text-cyan" />
            <h3>Oracle 데이터베이스 세션 연결 설정</h3>
          </div>
          <button className="close-btn" onClick={onClose}>
            <X className="icon" />
          </button>
        </div>

        <form onSubmit={handleSave} className="modal-body">
          <p className="modal-subtitle">
            로컬 백엔드 에이전트(npm run server)를 통해 실제 Oracle 연결을 테스트합니다. 비밀번호는 백엔드에 저장되지 않고, 이 화면의 메모리에서만 유지됩니다.
          </p>

          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">
                <Server className="label-icon text-cyan" />
                <span>DB Host IP / Hostname</span>
              </label>
              <input
                type="text"
                className="form-input"
                value={formData.host}
                onChange={(e) => setFormData({ ...formData, host: e.target.value })}
                placeholder="192.168.1.100 또는 localhost"
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">
                <Activity className="label-icon text-amber" />
                <span>Listener Port</span>
              </label>
              <input
                type="number"
                className="form-input"
                value={formData.port}
                onChange={(e) => setFormData({ ...formData, port: Number(e.target.value) })}
                placeholder="1521"
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">
                <Database className="label-icon text-purple" />
                <span>Service Name / SID</span>
              </label>
              <input
                type="text"
                className="form-input"
                value={formData.serviceName}
                onChange={(e) => setFormData({ ...formData, serviceName: e.target.value })}
                placeholder="ORCL 또는 XE"
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">
                <User className="label-icon text-green" />
                <span>DB User (계정명)</span>
              </label>
              <input
                type="text"
                className="form-input"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                placeholder="SYSTEM 또는 SYSDBA"
                required
              />
            </div>

            <div className="form-group full-width">
              <label className="form-label">
                <Lock className="label-icon text-red" />
                <span>비밀번호 (Password)</span>
              </label>
              <input
                type="password"
                className="form-input"
                value={formData.password || ''}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                placeholder="••••••••"
                required
              />
            </div>

            <div className="form-group full-width">
              <label className="form-label">
                <KeyRound className="label-icon text-amber" />
                <span>로컬 에이전트 토큰 (선택)</span>
              </label>
              <input
                type="password"
                className="form-input"
                value={formData.agentToken || ''}
                onChange={(e) => setFormData({ ...formData, agentToken: e.target.value })}
                placeholder="에이전트 실행 시 OTUNE_API_TOKEN을 설정한 경우에만 입력"
              />
            </div>

            <div className="form-group full-width checkbox-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={formData.useDrcp}
                  onChange={(e) => setFormData({ ...formData, useDrcp: e.target.checked })}
                />
                <span>DRCP (Database Resident Connection Pooling) 활성화</span>
              </label>
              <span className="checkbox-desc">수천 개의 동시 웹 커넥션 연결 시 DB 서버 메모리 절감</span>
            </div>
          </div>

          {/* 연결 테스트 결과 */}
          {testResult && (
            <div className="test-result-box">
              {testResult.kind === 'success'
                ? <CheckCircle2 className="icon text-green" />
                : <AlertTriangle className="icon text-red" />}
              <span>{testResult.message}</span>
            </div>
          )}

          {/* TNSNAMES.ORA 자동 생성 프리뷰 */}
          <div className="tns-preview-box">
            <span className="tns-label">자동 생성된 TNSNAMES.ORA 문자열</span>
            <pre className="code-content tns-code">{tnsString}</pre>
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="action-btn test-btn"
              onClick={handleTestConnection}
              disabled={testing}
            >
              {testing ? <RefreshCw className="icon animate-spin" /> : <Activity className="icon text-cyan" />}
              <span>{testing ? '연결 테스트 중...' : 'DB 연결 테스트'}</span>
            </button>

            <button type="submit" className="action-btn primary-btn" disabled={testing}>
              <CheckCircle2 className="icon" />
              <span>{testing ? '연결 확인 중...' : '연결 확인 후 저장하고 실데이터 조회'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
