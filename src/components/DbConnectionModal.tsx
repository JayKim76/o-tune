import React, { useEffect, useRef, useState } from 'react';
import type { OracleConnectionConfig, OracleConnectionTestResult } from '../types/oracle';
import { checkOracleAgent, testOracleConnection } from '../utils/oracleBackendApi';
import { Database, Server, User, CheckCircle2, X, Activity, RefreshCw, Lock, AlertTriangle, KeyRound, Eye, EyeOff } from 'lucide-react';

interface DbConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: OracleConnectionConfig;
  onSaveConfig: (newConfig: OracleConnectionConfig) => void;
}

/** 연결 테스트를 다시 하지 않아도 되는 유효 시간(ms). 이 안에 폼이 그대로면 직전 성공을 재사용한다. */
const TEST_REUSE_MS = 120_000;

function formFingerprint(form: OracleConnectionConfig): string {
  return JSON.stringify({
    host: form.host, port: form.port, serviceName: form.serviceName,
    username: form.username, password: form.password || '',
    useDrcp: form.useDrcp, agentToken: form.agentToken || '',
  });
}

/** 브라우저 단계 검증. 서버(oracleData.mjs)도 같은 규칙으로 다시 검증한다. */
function validateForm(form: OracleConnectionConfig): string | null {
  if (!form.host.trim()) return 'DB Host를 입력해 주세요.';
  if (!/^[A-Za-z0-9._-]+$/.test(form.host.trim())) return 'DB Host 형식이 올바르지 않습니다. (영문, 숫자, ., _, - 만 허용)';
  if (!Number.isInteger(form.port) || form.port < 1 || form.port > 65535) return 'Listener Port는 1~65535 사이의 정수여야 합니다.';
  if (!form.serviceName.trim()) return 'Service Name을 입력해 주세요.';
  if (!form.username.trim()) return 'DB User를 입력해 주세요.';
  if (!form.password) return '비밀번호를 입력해 주세요.';
  return null;
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
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [agentStatus, setAgentStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const lastTestRef = useRef<{ fingerprint: string; at: number; result: OracleConnectionTestResult } | null>(null);

  // 모달이 열릴 때마다 바깥(App)의 최신 연결 설정을 폼에 반영한다.
  const [wasOpen, setWasOpen] = useState<boolean>(false);
  if (isOpen && !wasOpen) {
    setWasOpen(true);
    setFormData({ ...config });
    setTestResult(null);
    setShowPassword(false);
    setAgentStatus('checking');
  } else if (!isOpen && wasOpen) {
    setWasOpen(false);
  }

  // 열릴 때 로컬 에이전트 상태부터 확인한다. 에이전트가 꺼져 있으면
  // 연결 테스트를 눌러 보기 전에 그 사실과 실행 방법을 보여 준다.
  useEffect(() => {
    if (!isOpen) return;
    lastTestRef.current = null;
    let cancelled = false;
    checkOracleAgent().then((ok) => {
      if (!cancelled) setAgentStatus(ok ? 'online' : 'offline');
    });
    return () => { cancelled = true; };
  }, [isOpen]);

  // ESC로 닫기
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const runTest = async (): Promise<OracleConnectionTestResult | null> => {
    const validationError = validateForm(formData);
    if (validationError) {
      setTestResult({ kind: 'error', message: validationError });
      return null;
    }
    // 폼이 바뀌지 않았고 직전 성공이 유효 시간 안이면 연결을 새로 맺지 않는다.
    const fingerprint = formFingerprint(formData);
    const last = lastTestRef.current;
    if (last && last.fingerprint === fingerprint && Date.now() - last.at < TEST_REUSE_MS) {
      return last.result;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testOracleConnection(formData);
      lastTestRef.current = { fingerprint, at: Date.now(), result };
      setTestResult({
        kind: 'success',
        message: `연결 성공 · 응답 ${result.latencyMs}ms · DB ${result.databaseName || '-'} · Oracle ${result.version || '버전 미확인'} · 사용자 ${result.currentUser || formData.username}`,
      });
      return result;
    } catch (error) {
      lastTestRef.current = null;
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

  // 백엔드가 실제로 사용하는 Easy Connect 문자열 (server/oracleData.mjs buildConnectString과 동일 규칙)
  const connectString = `${formData.host || 'localhost'}:${formData.port || 1521}/${formData.serviceName || 'ORCL'}${formData.useDrcp ? ':POOLED' : ''}`;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card animate-fade-in" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-wrap">
            <Database className="icon text-cyan" />
            <h3>Oracle 데이터베이스 세션 연결 설정</h3>
          </div>
          <button type="button" className="close-btn" onClick={onClose} aria-label="닫기">
            <X className="icon" />
          </button>
        </div>

        <form onSubmit={handleSave} className="modal-body">
          <p className="modal-subtitle">
            로컬 백엔드 에이전트(npm run server)를 통해 실제 Oracle 연결을 테스트합니다. 비밀번호는 백엔드에 저장되지 않고, 이 화면의 메모리에서만 유지됩니다.
          </p>

          {agentStatus !== 'online' && (
            <div className="test-result-box">
              {agentStatus === 'checking'
                ? <RefreshCw className="icon animate-spin" />
                : <AlertTriangle className="icon text-red" />}
              <span>
                {agentStatus === 'checking'
                  ? '로컬 백엔드 에이전트 상태를 확인하고 있습니다.'
                  : '로컬 백엔드 에이전트에 닿지 않습니다. 프로젝트 폴더에서 npm run server를 먼저 실행해 주세요.'}
              </span>
            </div>
          )}

          <div className="form-grid">
            <div className="form-group">
              <label className="form-label" htmlFor="db-host">
                <Server className="label-icon text-cyan" />
                <span>DB Host IP / Hostname</span>
              </label>
              <input
                id="db-host"
                type="text"
                className="form-input"
                value={formData.host}
                onChange={(e) => setFormData({ ...formData, host: e.target.value })}
                placeholder="localhost 또는 192.168.1.100"
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="db-port">
                <Activity className="label-icon text-amber" />
                <span>Listener Port</span>
              </label>
              <input
                id="db-port"
                type="number"
                className="form-input"
                min={1}
                max={65535}
                value={formData.port}
                onChange={(e) => setFormData({ ...formData, port: Number(e.target.value) })}
                placeholder="1521"
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="db-service">
                <Database className="label-icon text-purple" />
                <span>Service Name</span>
              </label>
              <input
                id="db-service"
                type="text"
                className="form-input"
                value={formData.serviceName}
                onChange={(e) => setFormData({ ...formData, serviceName: e.target.value })}
                placeholder="ORCL 또는 FREEPDB1"
                required
              />
              <span className="field-desc">SID가 아니라 서비스명입니다. DB에서 SELECT value FROM v$parameter WHERE name = &apos;service_names&apos;로 확인할 수 있습니다.</span>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="db-user">
                <User className="label-icon text-green" />
                <span>DB User (계정명)</span>
              </label>
              <input
                id="db-user"
                type="text"
                className="form-input"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                placeholder="SYSTEM"
                required
              />
              <span className="field-desc">SYSDBA 권한 접속은 지원하지 않습니다. V$ 뷰 조회 권한이 있는 일반 계정을 사용해 주세요.</span>
            </div>

            <div className="form-group full-width">
              <label className="form-label" htmlFor="db-password">
                <Lock className="label-icon text-red" />
                <span>비밀번호 (Password)</span>
              </label>
              <div className="password-wrap">
                <input
                  id="db-password"
                  type={showPassword ? 'text' : 'password'}
                  className="form-input"
                  value={formData.password || ''}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder="••••••••"
                  required
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 보기'}
                >
                  {showPassword ? <EyeOff className="icon" /> : <Eye className="icon" />}
                </button>
              </div>
            </div>

            <div className="form-group full-width">
              <label className="form-label" htmlFor="db-agent-token">
                <KeyRound className="label-icon text-amber" />
                <span>로컬 에이전트 토큰 (선택)</span>
              </label>
              <input
                id="db-agent-token"
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
              <span className="checkbox-desc">DB 서버에 DRCP가 설정되어 있을 때만 켜세요. 설정되어 있지 않으면 연결이 실패합니다.</span>
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

          {/* 백엔드가 실제로 사용하는 접속 문자열 미리보기 */}
          <div className="tns-preview-box">
            <span className="tns-label">백엔드 접속 문자열 (Easy Connect)</span>
            <pre className="code-content tns-code">{connectString}</pre>
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
