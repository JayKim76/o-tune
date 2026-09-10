import React, { useState } from 'react';
import { ORACLE_TUNING_QUERIES } from '../data/mockOracleData';
import { BookOpen, Copy, Check, Network, Cpu } from 'lucide-react';

export const TuningToolkit: React.FC = () => {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const handleCopy = (sql: string, index: number) => {
    navigator.clipboard.writeText(sql);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <div className="toolkit-container">
      <div className="section-header">
        <div>
          <h2 className="section-title">
            <BookOpen className="icon text-cyan" />
            <span>Oracle DBA 필수 튜닝 쿼리 & 최적화 팁 툴킷</span>
          </h2>
          <p className="section-subtitle">
            구글 노트북 연구 노트 자료를 기반으로 선별된 오라클 DB 성능 진단 쿼리 모음집 및 네트워크/커넥션 풀 최적화 노하우입니다.
          </p>
        </div>
      </div>

      {/* 쿼리 툴킷 리스트 */}
      <div className="query-grid">
        {ORACLE_TUNING_QUERIES.map((item, idx) => (
          <div key={idx} className="query-card">
            <div className="query-header">
              <div className="query-title-wrap">
                <span className="cat-badge">{item.category}</span>
                <h3 className="query-title">{item.title}</h3>
              </div>
              <button 
                className="action-btn copy-btn-sm"
                onClick={() => handleCopy(item.sqlText, idx)}
              >
                {copiedIndex === idx ? <Check className="icon text-green" /> : <Copy className="icon" />}
                <span>{copiedIndex === idx ? '복사됨' : 'SQL 복사'}</span>
              </button>
            </div>
            
            <p className="query-desc">{item.description}</p>
            
            <div className="code-snippet-box">
              <pre className="code-content">{item.sqlText}</pre>
            </div>
          </div>
        ))}
      </div>

      {/* DRCP & SDU 추가 최적화 가이드 */}
      <div className="advanced-tips-section">
        <h3 className="sub-section-title">
          <Network className="icon text-purple" />
          <span>추가 고급 노하우: DRCP 및 SDU 네트워크 패킷 최적화</span>
        </h3>

        <div className="tips-grid">
          <div className="tip-card">
            <div className="tip-header">
              <Cpu className="tip-icon text-cyan" />
              <h4>DRCP (Database Resident Connection Pooling)</h4>
            </div>
            <p className="tip-text">
              수천 명의 동시 접속자가 발생하는 웹 애플리케이션 환경에서 각 프로세스마다 메모리를 할당하는 Dedicated Server 방식 대신, Shared Pool 상의 연결 세션을 재사용하여 DB Server 메모리 소모량을 최소화합니다.
            </p>
            <div className="code-snippet-box">
              <pre className="code-content">{`-- DRCP 풀 활성화 명령어
EXEC DBMS_CONNECTION_POOL.START_POOL();

-- tnsnames.ora 연결 문자열 설정
ORCL_DRCP =
  (DESCRIPTION =
    (ADDRESS = (PROTOCOL = TCP)(HOST = db_host)(PORT = 1521))
    (CONNECT_DATA =
      (SERVER = POOLED)
      (SERVICE_NAME = orcl)
    )
  )`}</pre>
            </div>
          </div>

          <div className="tip-card">
            <div className="tip-header">
              <Network className="tip-icon text-amber" />
              <h4>SDU (Session Data Unit) 네트워크 최적화</h4>
            </div>
            <p className="tip-text">
              대량 조회 쿼리 수신 시 기본 8KB SDU 크기를 32KB로 상향 조정하여 네트워크 Round-Trip 횟수를 대폭 감소시키고 전송 대기시간(SQL*Net message from client/db)을 줄입니다.
            </p>
            <div className="code-snippet-box">
              <pre className="code-content">{`-- sqlnet.ora 및 listener.ora 파일 수정
DEFAULT_SDU_SIZE = 32768

-- tnsnames.ora 예시
ORCL_SDU =
  (DESCRIPTION =
    (SDU = 32768)
    (ADDRESS = (PROTOCOL = TCP)(HOST = db_host)(PORT = 1521))
    (CONNECT_DATA = (SERVICE_NAME = orcl))
  )`}</pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
