import React from 'react';
import { ArrowRight, ShieldCheck, Cpu, Sliders, LineChart } from 'lucide-react';

export const LearningLoopView: React.FC = () => {
  return (
    <div className="learning-container">
      <div className="section-header">
        <div>
          <h2 className="section-title">
            <LineChart className="icon text-purple" />
            <span>AI 모델의 3단계 튜닝 학습 루프 (Feedback Loop)</span>
          </h2>
          <p className="section-subtitle">
            단순한 힌트 나열을 넘어 오라클 옵티마이저의 비용 계산 방식을 근본적으로 교정하고 전체 시스템 기여도를 계량화합니다.
          </p>
        </div>
      </div>

      <div className="steps-wrapper">
        {/* Step 1 */}
        <div className="step-card">
          <div className="step-badge-header">
            <div className="step-circle">1</div>
            <div className="step-title-wrap">
              <h3>Step 1: SQL 정규화 및 추상화 (Normalization)</h3>
              <span className="step-subtitle-tag">하드 파싱 차단 & 시그니처화</span>
            </div>
          </div>
          <div className="step-body">
            <p className="step-text">
              수집된 SQL문에서 리터럴 값(상수)을 상위 수준의 바인드 변수시그니처로 추상화하여 라이브러리 캐시 래치 경락을 차단합니다.
            </p>
            <div className="code-compare-box">
              <div className="compare-col">
                <span className="col-label text-red">RAW SQL (리터럴 남용)</span>
                <code>WHERE deptno = 10 AND status = 'ACTIVE'</code>
              </div>
              <ArrowRight className="compare-icon" />
              <div className="compare-col">
                <span className="col-label text-green">Normalized (바인드 변수)</span>
                <code>WHERE deptno = :b1 AND status = :b2</code>
              </div>
            </div>
          </div>
        </div>

        {/* Step 2 */}
        <div className="step-card">
          <div className="step-badge-header">
            <div className="step-circle">2</div>
            <div className="step-title-wrap">
              <h3>Step 2: 최적 대안 탐색 및 힌트 도출 (Exploration)</h3>
              <span className="step-subtitle-tag">Bind Peeking & Skew 문제 회피</span>
            </div>
          </div>
          <div className="step-body">
            <p className="step-text">
              데이터 편향성(Data Skew)에 따른 바인드 변수 피킹(Peeking) 문제와 Plan Flip-flop 현상을 감지하고, 단순 힌트를 넘어 <strong>SQL Profile 내부 OPT_ESTIMATE</strong> 힌트를 주입합니다.
            </p>

            <div className="hint-strategy-grid">
              <div className="strategy-pill">
                <Sliders className="pill-icon text-cyan" />
                <div>
                  <strong>OPT_ESTIMATE 힌트</strong>
                  <p>옵티마이저의 통계치 예측 Row 수 보정</p>
                </div>
              </div>
              <div className="strategy-pill">
                <Cpu className="pill-icon text-purple" />
                <div>
                  <strong>USE_HASH & LEADING</strong>
                  <p>대용량 조인 시 Driving Table 및 Hash Join 강제</p>
                </div>
              </div>
              <div className="strategy-pill">
                <ShieldCheck className="pill-icon text-green" />
                <div>
                  <strong>SQL Profile 연동</strong>
                  <p>소스 코드 수정 없는 데이터 딕셔너리 수준 힌트 주입</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Step 3 */}
        <div className="step-card highlight-card">
          <div className="step-badge-header">
            <div className="step-circle green-circle">3</div>
            <div className="step-title-wrap">
              <h3>Step 3: 성능 피드백 및 계량화 (Feedback & Metric)</h3>
              <span className="step-subtitle-tag text-green">Total DB Time 절감 비중 측정</span>
            </div>
          </div>
          <div className="step-body">
            <p className="step-text">
              개선율(Benefit)은 단순히 단일 쿼리의 수행 속도 향상이 아니라, <strong>전체 스냅샷 기간의 Total DB Time에서 절감된 시간의 비중</strong>으로 계량화합니다.
            </p>

            <div className="formula-box">
              <div className="formula-header">Improvement Benefit Calculation Formula</div>
              <div className="formula-math">
                Benefit (%) = [ (Original DB Time - Tuned DB Time) / Total System DB Time (Snapshot) ] × 100
              </div>
              <p className="formula-note">
                이를 통해 개별 튜닝 작업이 데이터베이스 인프라 전체에 미치는 기여도를 정밀하고 객관적으로 평가합니다.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
