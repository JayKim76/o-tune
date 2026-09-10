import React, { useState } from 'react';
import type { LmStudioConfig } from '../types/oracle';
import { checkLmStudioStatus } from '../utils/lmStudioApi';
import { Bot, RefreshCw, CheckCircle2, XCircle, X, Server, Cpu } from 'lucide-react';

interface LmStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: LmStudioConfig;
  onSaveConfig: (newConfig: LmStudioConfig) => void;
}

export const LmStudioModal: React.FC<LmStudioModalProps> = ({
  isOpen,
  onClose,
  config,
  onSaveConfig,
}) => {
  const [serverUrl, setServerUrl] = useState<string>(config.serverUrl);
  const [activeModel, setActiveModel] = useState<string>(config.activeModel);
  const [availableModels, setAvailableModels] = useState<string[]>(config.availableModels);
  const [status, setStatus] = useState<'ONLINE' | 'OFFLINE' | 'CHECKING'>(config.status);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [message, setMessage] = useState<string>('');

  if (!isOpen) return null;

  const handleTestConnection = async () => {
    setIsTesting(true);
    setStatus('CHECKING');
    setMessage('LM Studio 로컬 서버(http://localhost:1234) 연결 상태 및 모델 목록 조회 중...');

    const result = await checkLmStudioStatus(serverUrl);
    setIsTesting(false);

    if (result.isOnline) {
      setStatus('ONLINE');
      setAvailableModels(result.models);
      if (result.models.length > 0 && !result.models.includes(activeModel)) {
        setActiveModel(result.models[0]);
      }
      setMessage(`서버 접속 성공! 감지된 로컬 AI 모델 수: ${result.models.length}개`);
    } else {
      setStatus('OFFLINE');
      setMessage('LM Studio 서버 접속 실패. LM Studio 앱에서 HTTP Server가 실행 중인지 확인하세요.');
    }
  };

  const handleSave = () => {
    onSaveConfig({
      serverUrl,
      activeModel: activeModel || (availableModels[0] || 'default-model'),
      availableModels,
      status,
      lastCheckedAt: new Date().toLocaleTimeString(),
    });
    onClose();
  };

  return (
    <div className="modal-overlay animate-fade-in">
      <div className="modal-container">
        <div className="modal-header">
          <div className="flex-align gap-2">
            <Bot className="icon text-amber" />
            <h3 className="modal-title">LM Studio 로컬 AI 서버 연동 설정</h3>
          </div>
          <button className="close-btn" onClick={onClose}>
            <X className="icon" />
          </button>
        </div>

        <div className="modal-body space-y-4">
          <p className="modal-desc">
            LM Studio에서 제공하는 로컬 HTTP 서버(기본: <code className="code-tag">http://localhost:1234</code>)에 직접 연결하여 
            외부 인터넷 전송 없이 오라클 SQL 튜닝 및 실행계획 심층 분석을 수행합니다.
          </p>

          <div className="form-group">
            <label className="form-label flex-align gap-1">
              <Server className="icon-sm text-cyan" />
              <span>LM Studio Server API Endpoint URL</span>
            </label>
            <div className="flex-gap">
              <input
                type="text"
                className="input-field flex-1"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="http://localhost:1234"
              />
              <button
                type="button"
                className="action-btn test-btn"
                onClick={handleTestConnection}
                disabled={isTesting}
              >
                <RefreshCw className={`btn-icon ${isTesting ? 'animate-spin' : ''}`} />
                <span>연결 테스트</span>
              </button>
            </div>
          </div>

          {message && (
            <div className={`status-banner ${status === 'ONLINE' ? 'success' : status === 'OFFLINE' ? 'error' : 'info'}`}>
              {status === 'ONLINE' && <CheckCircle2 className="icon text-green" />}
              {status === 'OFFLINE' && <XCircle className="icon text-red" />}
              {status === 'CHECKING' && <RefreshCw className="icon text-amber animate-spin" />}
              <span>{message}</span>
            </div>
          )}

          <div className="form-group">
            <label className="form-label flex-align gap-1">
              <Cpu className="icon-sm text-purple" />
              <span>활성화할 로컬 AI 튜닝 모델 (Active Local Model)</span>
            </label>
            {availableModels.length > 0 ? (
              <select
                className="select-field"
                value={activeModel}
                onChange={(e) => setActiveModel(e.target.value)}
              >
                {availableModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                className="input-field"
                value={activeModel}
                onChange={(e) => setActiveModel(e.target.value)}
                placeholder="예: qwen/qwen3.5-9b 또는 google/gemma-4-e4b"
              />
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button className="action-btn secondary-btn" onClick={onClose}>
            취소
          </button>
          <button className="action-btn primary-btn" onClick={handleSave}>
            설정 저장 및 적용
          </button>
        </div>
      </div>
    </div>
  );
};
