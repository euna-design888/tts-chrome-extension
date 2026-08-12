/**
 * content/reader_overlay.js - 저시력자 맞춤형 고대비 리더뷰 오버레이 (Reader View Overlay)
 * 산만한 원본 웹페이지에서 텍스트를 추출하여 시각적 고대비 스킨 환경에서 낭독합니다.
 */

window.ReaderOverlay = class ReaderOverlay {
  constructor(ttsEngine) {
    this.ttsEngine = ttsEngine;
    this.overlayElement = null;
    this.isOpen = false;
    this.parsedSegments = [];
    this.currentFontSize = 28; // 저시력자 기본 권장 크기 28px
    this.currentTheme = 'theme-high-contrast-dark';
  }

  /**
   * 리더뷰 오버레이를 화면에 생성하거나 엽니다.
   * @param {Array<{ element: Element, text: string }>} segments 
   */
  open(segments) {
    this.parsedSegments = segments;
    if (!this.overlayElement) {
      this.createOverlayDOM();
    }

    this.renderContent();
    this.overlayElement.style.display = 'flex';
    this.isOpen = true;

    // 키보드 접근성 F2 닫기 및 Ctrl+Space 일시정지/재개
    this.onKeyDown = (e) => {
      if (e.key === 'F2' || e.code === 'F2' || e.keyCode === 113) this.close();
      if (e.ctrlKey && (e.code === 'Space' || e.key === ' ' || e.keyCode === 32)) {
        e.preventDefault();
        this.togglePlayPause();
      }
    };
    window.addEventListener('keydown', this.onKeyDown);
  }

  close() {
    if (this.overlayElement) {
      this.overlayElement.style.display = 'none';
    }
    this.isOpen = false;
    this.ttsEngine.stop();
    window.removeEventListener('keydown', this.onKeyDown);
  }

  createOverlayDOM() {
    const overlay = document.createElement('div');
    overlay.id = 'tts-reader-overlay';
    overlay.className = this.currentTheme;

    overlay.innerHTML = `
      <div class="tts-reader-header">
        <div class="tts-reader-title">👁️ 소리뷰 (SoriView) 리더뷰</div>
        <div class="tts-reader-controls">
          <button class="tts-reader-btn" id="btn-font-decrease">가- (축소)</button>
          <button class="tts-reader-btn" id="btn-font-increase">가+ (확대)</button>
          <select class="tts-reader-btn" id="select-theme">
            <option value="theme-high-contrast-dark">고대비: 검정/노랑</option>
            <option value="theme-high-contrast-yellow">고대비: 검정/청록</option>
            <option value="theme-high-contrast-light">고대비: 밝은크림/검정</option>
          </select>
          <button class="tts-reader-btn" id="btn-close-overlay">✕ 닫기 (F2)</button>
        </div>
      </div>
      
      <div class="tts-reader-content" id="tts-reader-content-body" style="font-size: ${this.currentFontSize}px;">
      </div>

      <div class="tts-reader-player">
        <button class="tts-reader-btn" id="btn-player-prev">⏮️ 이전 문장</button>
        <button class="tts-reader-btn" id="btn-player-play">▶️ 낭독 시작</button>
        <button class="tts-reader-btn" id="btn-player-next">⏭️ 다음 문장</button>
        <button class="tts-reader-btn" id="btn-player-stop">⏹️ 정지</button>
      </div>
    `;

    document.body.appendChild(overlay);
    this.overlayElement = overlay;

    this.bindEvents();
  }

  bindEvents() {
    // 폰트 크기 변경
    this.overlayElement.querySelector('#btn-font-increase').addEventListener('click', () => {
      this.currentFontSize = Math.min(this.currentFontSize + 4, 52);
      this.updateFontSize();
    });

    this.overlayElement.querySelector('#btn-font-decrease').addEventListener('click', () => {
      this.currentFontSize = Math.max(this.currentFontSize - 4, 18);
      this.updateFontSize();
    });

    // 테마 변경
    this.overlayElement.querySelector('#select-theme').addEventListener('change', (e) => {
      this.currentTheme = e.target.value;
      this.overlayElement.className = this.currentTheme;
    });

    // 닫기
    this.overlayElement.querySelector('#btn-close-overlay').addEventListener('click', () => this.close());

    // 오디오 플레이어 제어
    const playBtn = this.overlayElement.querySelector('#btn-player-play');
    playBtn.addEventListener('click', () => this.togglePlayPause());

    this.overlayElement.querySelector('#btn-player-prev').addEventListener('click', () => {
      this.ttsEngine.previous();
    });

    this.overlayElement.querySelector('#btn-player-next').addEventListener('click', () => {
      this.ttsEngine.next();
    });

    this.overlayElement.querySelector('#btn-player-stop').addEventListener('click', () => {
      this.ttsEngine.stop();
      playBtn.innerText = '▶️ 낭독 시작';
    });
  }

  togglePlayPause() {
    const playBtn = this.overlayElement.querySelector('#btn-player-play');
    if (!this.ttsEngine.isPlaying) {
      this.ttsEngine.speakSegments(this.parsedSegments, 0);
      playBtn.innerText = '⏸️ 일시정지';
    } else if (this.ttsEngine.isPaused) {
      this.ttsEngine.resume();
      playBtn.innerText = '⏸️ 일시정지';
    } else {
      this.ttsEngine.pause();
      playBtn.innerText = '▶️ 계속 낭독';
    }
  }

  updateFontSize() {
    const contentBody = this.overlayElement.querySelector('#tts-reader-content-body');
    if (contentBody) {
      contentBody.style.fontSize = `${this.currentFontSize}px`;
    }
  }

  renderContent() {
    const contentBody = this.overlayElement.querySelector('#tts-reader-content-body');
    contentBody.innerHTML = '';

    this.parsedSegments.forEach((seg, idx) => {
      const p = document.createElement('div');
      p.className = 'tts-reader-paragraph';
      p.dataset.index = idx;
      p.innerText = seg.text;
      
      // 클릭 시 해당 문장부터 바로 낭독
      p.addEventListener('click', () => {
        this.ttsEngine.speakSegments(this.parsedSegments, idx);
        this.overlayElement.querySelector('#btn-player-play').innerText = '⏸️ 일시정지';
      });

      contentBody.appendChild(p);
    });
  }

  /**
   * 현재 낭독 중인 단락을 리더뷰 상에서 하이라이팅 처리
   * @param {number} activeIndex 
   */
  highlightActiveParagraph(activeIndex) {
    if (!this.overlayElement) return;

    const paragraphs = this.overlayElement.querySelectorAll('.tts-reader-paragraph');
    paragraphs.forEach((p, idx) => {
      if (idx === activeIndex) {
        p.classList.add('active-reader-segment');
        p.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        p.classList.remove('active-reader-segment');
      }
    });
  }
};
