import React, { useState } from 'react';
import type { OracleConnectionConfig } from '../types/oracle';
import { Database, Server, User, CheckCircle2, X, Activity, RefreshCw, Lock } from 'lucide-react';

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
  const [testResult, setTestResult] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleTestConnection = () => {
    setTesting(true);
    setTestResult(null);
    setTimeout(() => {
      setTesting(false);
      // 브라우저에서는 Oracle에 직접 접속할 수 없다. 성공으로 가장하지 않고 한계를 그대로 알린다.
      setTestResult('실제 연결 테스트는 수행되지 않았습니다. 브라우저에서 Oracle DB로 직접 연결할 수 없으며, 실연동에는 백엔드 또는 로컬 에이전트가 필요합니다. 입력값은 화면 표기용으로만 저장됩니다.');
    }, 600);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveConfig({
      ...formData,
      status: 'DISCONNECTED',
      lastConnectedAt: undefined
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
            오라클 DB 커넥션 파라미터를 지정합니다. 현재 버전은 실연동 백엔드가 없어, 설정값은 화면 표기용으로만 쓰입니다.
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
              <CheckCircle2 className="icon" />
              <span>{testResult}</span>
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

            <button type="submit" className="action-btn primary-btn">
              <CheckCircle2 className="icon" />
              <span>연결 설정 적용 및 저장</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
