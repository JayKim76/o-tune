import React, { useState } from 'react';
import type { DiagnosticInput, DiagnosticOutput, TopSqlItem, LmStudioConfig, LmStudioDiagnosticResult } from '../types/oracle';
import { runFullDiagnostics } from '../utils/sqlParser';
import { analyzeSqlWithLmStudio } from '../utils/lmStudioApi';
import { CheckCircle2, AlertTriangle, Code, ArrowRight, Copy, Check, Sparkles, Bot, RefreshCw, Server } from 'lucide-react';

interface SqlDiagnoserProps {
  selectedSqlItem?: TopSqlItem | null;
  lmConfig: LmStudioConfig;
  onOpenLmStudioModal: () => void;
}

export const SqlDiagnoser: React.FC<SqlDiagnoserProps> = ({ 
  selectedSqlItem,
  lmConfig,
  onOpenLmStudioModal
}) => {
  const [rawSql, setRawSql] = useState<string>(
    selectedSqlItem?.sqlText || 
`SELECT e.empno, e.ename, d.dname, e.sal
FROM emp e, dept d
WHERE e.deptno = d.deptno
  AND e.job = 'MANAGER'
  AND e.sal > 3000`
  );

  const [executionPlanText, setExecutionPlanText] = useState<string>(
    selectedSqlItem?.executionPlan ||
`-------------------------------------------------------------------------------------------------
| Id  | Operation                  | Name  | Rows  | Bytes | Cost (%CPU)| Time     |
-------------------------------------------------------------------------------------------------
|   0 | SELECT STATEMENT           |       |  1450 | 58000 |  1240   (2)| 00:00:15 |
|*  1 |  HASH JOIN                 |       |  1450 | 58000 |  1240   (2)| 00:00:15 |
|*  2 |   TABLE ACCESS FULL        | EMP   | 14500 | 435000|  1120   (2)| 00:00:14 |
|   3 |   TABLE ACCESS FULL        | DEPT  |     4 |    40 |     3   (0)| 00:00:01 |
-------------------------------------------------------------------------------------------------`
  );

  const [diagnosticResult, setDiagnosticResult] = useState<DiagnosticOutput | null>(null);
  const [lmResult, setLmResult] = useState<LmStudioDiagnosticResult | null>(null);
  const [isLmAnalyzing, setIsLmAnalyzing] = useState<boolean>(false);
  const [lmError, setLmError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [activeEngine, setActiveEngine] = useState<'LM_STUDIO' | 'RULE_ENGINE'>('LM_STUDIO');

  // 규칙 기반 파서 진단
  const handleDiagnoseRuleEngine = () => {
    setActiveEngine('RULE_ENGINE');
    const input: DiagnosticInput = { rawSql, executionPlanText };
    const output = runFullDiagnostics(input);
    setDiagnosticResult(output);
    setLmError(null);
  };

  // LM Studio 로컬 AI 진단
  const handleDiagnoseLmStudio = async () => {
    setActiveEngine('LM_STUDIO');
    setIsLmAnalyzing(true);
    setLmError(null);

    try {
      const result = await analyzeSqlWithLmStudio(rawSql, executionPlanText, lmConfig);
      setLmResult(result);
      
      // 파서의 정규화 등 보조 정보도 함께 수집
      const ruleOutput = runFullDiagnostics({ rawSql, executionPlanText });
      setDiagnosticResult(ruleOutput);
    } catch (err: any) {
      console.error('LM Studio 튜닝 실패:', err);
      setLmError(`LM Studio 연결 오류: ${err?.message || '로컬 AI 응답 실패'}. Rule Engine으로 자동 전환합니다.`);
      // 자동 폴백: Rule Engine 진단 실행
      handleDiagnoseRuleEngine();
    } finally {
      setIsLmAnalyzing(false);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="diagnoser-container">
      <div className="section-header">
        <div>
          <h2 className="section-title">
            <Bot className="icon text-amber" />
            <span>LM Studio 로컬 AI + 오라클 튜닝 진단 엔진</span>
          </h2>
          <p className="section-subtitle">
            SQL문 및 DBMS_XPLAN 실행계획을 LM Studio의 로컬 AI 모델(OpenAI 호환 API <code className="code-tag">http://localhost:1234</code>)에 전달하여 안티패턴, 힌트, 튜닝 SQL을 생성합니다.
          </p>
        </div>

        <div className="action-btn-group">
          <button 
            className={`action-btn run-btn ${activeEngine === 'LM_STUDIO' ? 'highlight-lm' : ''}`}
            onClick={handleDiagnoseLmStudio}
            disabled={isLmAnalyzing}
          >
            {isLmAnalyzing ? (
              <RefreshCw className="btn-icon animate-spin text-amber" />
            ) : (
              <Bot className="btn-icon text-amber" />
            )}
            <span>LM Studio 로컬 AI 튜닝 실행</span>
          </button>

          <button 
            className="action-btn secondary-btn"
            onClick={handleDiagnoseRuleEngine}
            disabled={isLmAnalyzing}
          >
            <Sparkles className="btn-icon text-cyan" />
            <span>AI Rule Engine 진단</span>
          </button>
        </div>
      </div>

      {/* LM Studio 서버 상태 알림 바 */}
      <div className="lm-status-bar flex-between">
        <div className="flex-align gap-2">
          <Server className="icon-sm text-cyan" />
          <span>LM Studio API Server: <strong className="code-tag">{lmConfig.serverUrl}</strong></span>
          <span className={`pill-badge ${lmConfig.status === 'ONLINE' ? 'online' : 'offline'}`}>
            {lmConfig.status === 'ONLINE' ? `ONLINE (${lmConfig.activeModel || 'Loaded Model'})` : 'OFFLINE'}
          </span>
        </div>
        <button className="link-btn" onClick={onOpenLmStudioModal}>
          LM Studio 설정 / 모델 변경
        </button>
      </div>

      <div className="input-grid">
        {/* SQL 문 입력 창 */}
        <div className="editor-box">
          <div className="editor-header">
            <Code className="icon text-cyan" />
            <span>오라클 SQL 문장 (RAW SQL)</span>
          </div>
          <textarea
            className="code-editor"
            value={rawSql}
            onChange={(e) => setRawSql(e.target.value)}
            placeholder="SELECT ... FROM ... WHERE ..."
            rows={8}
          />
        </div>

        {/* DBMS_XPLAN 실행 계획 입력 창 */}
        <div className="editor-box">
          <div className="editor-header">
            <Code className="icon text-purple" />
            <span>DBMS_XPLAN.DISPLAY_CURSOR 텍스트 실행 계획</span>
          </div>
          <textarea
            className="code-editor"
            value={executionPlanText}
            onChange={(e) => setExecutionPlanText(e.target.value)}
            placeholder="SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY_CURSOR(...)); 결과 paste"
            rows={8}
          />
        </div>
      </div>

      {/* 로딩 애니메이션 */}
      {isLmAnalyzing && (
        <div className="loading-card animate-fade-in">
          <RefreshCw className="loading-spinner icon text-amber animate-spin" />
          <h4>LM Studio 로컬 AI 모델이 SQL 및 실행계획을 분석하고 있습니다...</h4>
          <p className="loading-desc">
            모델: <strong className="text-cyan">{lmConfig.activeModel || 'qwen/qwen3.5-9b'}</strong> | 서버: {lmConfig.serverUrl}
          </p>
          <div className="loading-bar"><div className="loading-bar-inner"></div></div>
        </div>
      )}

      {/* 에러 및 폴백 메시지 */}
      {lmError && (
        <div className="status-banner error animate-fade-in">
          <AlertTriangle className="icon text-red" />
          <span>{lmError}</span>
        </div>
      )}

      {/* 1) LM Studio 로컬 AI 튜닝 결과 리포트 */}
      {activeEngine === 'LM_STUDIO' && lmResult && !isLmAnalyzing && (
        <div className="results-container animate-fade-in">
          <div className="results-header lm-header">
            <h3 className="results-title">
              <Bot className="icon text-amber" />
              <span>LM Studio 로컬 AI 심층 튜닝 보고서 ({lmConfig.activeModel || 'Local AI'})</span>
            </h3>
            <div className="benefit-badge highlight-gold">
              <span>예상 Total DB Time 절감 비중: <strong>+{lmResult.benefitRatioPercent}%</strong></span>
            </div>
          </div>

          {/* AI 총평 및 요약 카드 */}
          <div className="result-card lm-card">
            <div className="card-heading">
              <Sparkles className="icon text-amber" />
              <h4>로컬 AI 종합 튜닝 총평 & 분석 요약</h4>
            </div>
            <p className="lm-summary-text">{lmResult.summary}</p>
            {lmResult.recommendedHints.length > 0 && (
              <div className="hints-row">
                <span className="detail-label">권장 오라클 힌트:</span>
                <div className="hints-wrap">
                  {lmResult.recommendedHints.map((hint, idx) => (
                    <code key={idx} className="hint-code gold-hint">{hint}</code>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* AI 안티패턴 분석 카드 */}
          {lmResult.antiPatterns.length > 0 && (
            <div className="result-card">
              <div className="card-heading">
                <AlertTriangle className="icon text-red" />
                <h4>감지된 오라클 안티패턴 및 개선 가이드 (LM Studio AI)</h4>
              </div>
              <div className="antipattern-list">
                {lmResult.antiPatterns.map((ap, index) => (
                  <div key={index} className={`ap-item-card ap-border-${ap.severity.toLowerCase()}`}>
                    <div className="ap-item-header">
                      <div className="ap-title-group">
                        <AlertTriangle className={`ap-status-icon text-${ap.severity === 'HIGH' ? 'red' : 'amber'}`} />
                        <h5 className="ap-item-title">{ap.title}</h5>
                      </div>
                      <span className={`severity-pill pill-${ap.severity.toLowerCase()}`}>{ap.severity} RISK</span>
                    </div>
                    
                    <div className="ap-detail-box">
                      <div className="detail-row">
                        <span className="detail-label">감지 원인:</span>
                        <span className="detail-text">{ap.detectedLogic}</span>
                      </div>
                      <div className="detail-row">
                        <span className="detail-label">튜닝 권고:</span>
                        <span className="detail-text highlight-text">{ap.recommendation}</span>
                      </div>
                      {ap.suggestedHints && ap.suggestedHints.length > 0 && (
                        <div className="detail-row">
                          <span className="detail-label">주입 힌트:</span>
                          <div className="hints-wrap">
                            {ap.suggestedHints.map((h, hIdx) => (
                              <code key={hIdx} className="hint-code">{h}</code>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 튜닝 반영 최종 SQL */}
          <div className="result-card">
            <div className="card-heading flex-between">
              <div className="flex-align gap-2">
                <Code className="icon text-green" />
                <h4>LM Studio 로컬 AI 최적 튜닝 SQL (Tuned SQL)</h4>
              </div>
              <button 
                className="action-btn copy-btn"
                onClick={() => handleCopy(lmResult.tunedSql)}
              >
                {copied ? <Check className="icon text-green" /> : <Copy className="icon" />}
                <span>{copied ? '복사 완료' : '쿼리 복사'}</span>
              </button>
            </div>

            <div className="code-snippet-box tuned-box">
              <pre className="code-content text-green-glow">{lmResult.tunedSql}</pre>
            </div>

            <div className="metric-compare-bar">
              <div className="compare-item">
                <span className="cmp-label">비용 절감 예상</span>
                <span className="cmp-val text-amber">{lmResult.estimatedCostReduction}</span>
              </div>
              <ArrowRight className="cmp-arrow" />
              <div className="compare-item highlight-item">
                <span className="cmp-label">성능 개선 비중</span>
                <span className="cmp-val text-cyan">약 {lmResult.benefitRatioPercent}% 튜닝 향상</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2) AI Rule Engine 진단 결과 카드 출력 */}
      {activeEngine === 'RULE_ENGINE' && diagnosticResult && !isLmAnalyzing && (
        <div className="results-container animate-fade-in">
          <div className="results-header">
            <h3 className="results-title">
              <CheckCircle2 className="icon text-green" />
              <span>AI Rule Engine 진단 및 튜닝 추천 리포트</span>
            </h3>
            <div className="benefit-badge">
              <span>스냅샷 Total DB Time 절감 비중: <strong>+{diagnosticResult.benefitRatioPercent}%</strong></span>
            </div>
          </div>

          {/* 1. SQL 정규화 결과 */}
          <div className="result-card">
            <div className="card-heading">
              <span className="step-num">Step 1</span>
              <h4>SQL 정규화 및 리터럴 바인드 변수 추상화 (Normalization)</h4>
            </div>
            <p className="card-desc">
              하드 파싱 및 라이브러리 캐시 래치 경락 회피를 위해 리터럴 값을 바인드 변수 시그니처로 정규화했습니다.
            </p>
            <div className="code-snippet-box highlight">
              <pre className="code-content">{diagnosticResult.normalizedSql}</pre>
            </div>
            {diagnosticResult.extractedBindVariables.length > 0 && (
              <div className="bind-vars-list">
                <span className="bind-label">추출된 바인드 변수:</span>
                {diagnosticResult.extractedBindVariables.map((bv, i) => (
                  <span key={i} className="bind-chip">
                    {bv.name} = {bv.originalValue}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* 2. 안티패턴 감지 결과 리스트 */}
          <div className="result-card">
            <div className="card-heading">
              <span className="step-num">Step 2</span>
              <h4>안티패턴 감지 및 튜닝 권고안 (AI Rule Engine)</h4>
            </div>

            <div className="antipattern-list">
              {diagnosticResult.detectedAntiPatterns.map((ap, index) => (
                <div key={index} className={`ap-item-card ap-border-${ap.severity.toLowerCase()}`}>
                  <div className="ap-item-header">
                    <div className="ap-title-group">
                      <AlertTriangle className={`ap-status-icon text-${ap.severity === 'HIGH' ? 'red' : 'amber'}`} />
                      <h5 className="ap-item-title">{ap.title}</h5>
                    </div>
                    <span className={`severity-pill pill-${ap.severity.toLowerCase()}`}>{ap.severity} RISK</span>
                  </div>
                  
                  <div className="ap-detail-box">
                    <div className="detail-row">
                      <span className="detail-label">감지 로직:</span>
                      <span className="detail-text">{ap.detectedLogic}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">튜닝 권고안:</span>
                      <span className="detail-text highlight-text">{ap.recommendation}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">추천 힌트:</span>
                      <div className="hints-wrap">
                        {ap.suggestedHints.map((hint, hIdx) => (
                          <code key={hIdx} className="hint-code">{hint}</code>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 3. 튜닝 반영 최종 SQL 문장 */}
          <div className="result-card">
            <div className="card-heading flex-between">
              <div>
                <span className="step-num">Step 3</span>
                <h4>최적 힌트가 주입된 튜닝 완료 SQL (Tuned SQL)</h4>
              </div>
              <button 
                className="action-btn copy-btn"
                onClick={() => handleCopy(diagnosticResult.tunedSql)}
              >
                {copied ? <Check className="icon text-green" /> : <Copy className="icon" />}
                <span>{copied ? '복사 완료' : '쿼리 복사'}</span>
              </button>
            </div>

            <div className="code-snippet-box tuned-box">
              <pre className="code-content text-green-glow">{diagnosticResult.tunedSql}</pre>
            </div>

            <div className="metric-compare-bar">
              <div className="compare-item">
                <span className="cmp-label">튜닝 전 예상 소요시간</span>
                <span className="cmp-val text-red">{diagnosticResult.originalDbTimeSec} 초</span>
              </div>
              <ArrowRight className="cmp-arrow" />
              <div className="compare-item">
                <span className="cmp-label">튜닝 후 예상 소요시간</span>
                <span className="cmp-val text-green">{diagnosticResult.estimatedTunedDbTimeSec} 초</span>
              </div>
              <div className="compare-item highlight-item">
                <span className="cmp-label">속도 향상율 (Performance Gain)</span>
                <span className="cmp-val text-cyan">약 {(diagnosticResult.originalDbTimeSec / diagnosticResult.estimatedTunedDbTimeSec).toFixed(1)} 배 단축</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

