/**
 * content/hover_speaker.js - 클릭 & 드래그 낭독 연동 엔진 (v5 - 최종 방어)
 *
 * [핵심 방어 전략]
 * 1. e.isTrusted 체크: 구글 시트 내부 synthetic 이벤트(dispatchEvent) 완전 차단
 * 2. mousedown 시점에 shiftKey를 캡처: click 이벤트의 shiftKey보다 신뢰도 높음
 * 3. docs.google.com 도메인 체크: 자신(selfHost) 기준만 사용 (top 접근 오류 방지)
 * 4. 구글 시트에서 click 감지 시 shiftKey가 mousedown + click 양쪽에서 true여야 낭독
 */

window.HoverSpeaker = class HoverSpeaker {
  constructor(ttsEngine, parser) {
    this.ttsEngine = ttsEngine;
    this.parser = parser;
    this.enabled = true;
    this.lastSelectedText = '';

    // mousedown 시점의 Shift 상태 (click보다 더 신뢰할 수 있는 캡처)
    this._shiftAtMouseDown = false;

    // ★ 중복 인스턴스 방지: content_script.js 재주입 시 이벤트 리스너 중복 등록 차단
    // (기존 인스턴스가 이미 살아있으면 새 리스너를 추가하지 않음)
    if (window.__soriViewHoverSpeakerActive) {
      console.warn('[SoriView] ⚠️ HoverSpeaker 중복 인스턴스 감지 - 이벤트 리스너 재등록 건너뜀');
      return;
    }
    window.__soriViewHoverSpeakerActive = true;
    console.log('[SoriView] ✅ HoverSpeaker v5.1 초기화 완료 (구글 시트 이중 방어 활성)');

    this.initEventListeners();
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) this.clearSelectionHighlight();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 도메인 판별: selfHost 기준만 사용 (top 접근 시 cross-origin 오류 방지)
  // ─────────────────────────────────────────────────────────────────────────

  isGoogleDocsHost() {
    return window.location.hostname.includes('docs.google.com');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 텍스트 입력 중 여부 판단 (구글 시트/노션은 편집기 클릭도 낭독 허용)
  // ─────────────────────────────────────────────────────────────────────────

  isTypingTarget(target) {
    const el = target || document.activeElement;
    if (!el) return false;
    const tag = el.tagName ? el.tagName.toLowerCase() : '';

    // 구글 시트 / 노션: 전부 허용 (isGoogleDocsHost 체크는 click 핸들러에서 별도 수행)
    if (this.isGoogleDocsHost()) return false;
    const isNotion = window.location.hostname.includes('notion.so') ||
                     window.location.hostname.includes('notion.site') ||
                     Boolean(document.querySelector('.notion-page-content, .notion-frame'));
    if (isNotion) return false;

    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (el.closest && el.closest('input, textarea, select')) return true;
    if (el.isContentEditable) return true;
    if (el.closest && el.closest('[contenteditable="true"]')) return true;

    return false;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 이벤트 리스너 초기화
  // ─────────────────────────────────────────────────────────────────────────

  initEventListeners() {

    // ESC 키: 브라우저 기본 낭독 취소 동작 차단
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.keyCode === 27) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
    }, true);

    window.addEventListener('keyup', (e) => {
      if (e.key === 'Escape' || e.keyCode === 27) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
      if (e.key === 'Shift' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        this.hideSpotlightLens();
      }
    }, true);

    // 탭/창 포커스 잃을 때 상태 초기화
    window.addEventListener('blur', () => {
      this._shiftAtMouseDown = false;
      this.clearSelectionHighlight();
      this.hideSpotlightLens();
    });

    // ── mousedown: Shift 상태를 가장 신뢰할 수 있는 시점에 캡처 ──────────
    window.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        // 실제 사용자 마우스 클릭(isTrusted)에서만 Shift 상태 기록
        this._shiftAtMouseDown = e.isTrusted && e.shiftKey && !e.ctrlKey && !e.altKey;
      }
    }, true);

    window.addEventListener('mouseup', (e) => {
      if (e.button !== 0) return;
      // mouseup 이후 _shiftAtMouseDown 클리어 (다음 클릭까지 오염 방지)
      // click 핸들러가 먼저 실행되므로 약간의 지연 후 클리어
      setTimeout(() => { this._shiftAtMouseDown = false; }, 200);
    }, true);

    // ─────────────────────────────────────────────────────────────────────
    // Shift + 마우스 이동 → 스팟라이트 돋보기
    // ─────────────────────────────────────────────────────────────────────
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled || !e.shiftKey || e.ctrlKey || e.altKey) {
        this.hideSpotlightLens();
        return;
      }
      if (this.isGoogleDocsHost()) {
        this.hideSpotlightLens();
        return; // 구글 시트에서는 돋보기 비활성화 (자체 UI 방해 방지)
      }
      if (this.isTypingTarget(e.target)) {
        this.hideSpotlightLens();
        return;
      }
      const target = e.target;
      if (target && !this.parser.isHidden(target)) {
        const text = (target.innerText || target.textContent || '').trim();
        if (text.length > 0 && text.length < 400) {
          this.showSpotlightLens(e.clientX, e.clientY, text);
          return;
        }
      }
      this.hideSpotlightLens();
    }, true);

    // ─────────────────────────────────────────────────────────────────────
    // 1. Shift + 드래그 낭독 (mouseup)
    //    구글 시트는 완전 차단
    // ─────────────────────────────────────────────────────────────────────
    let _dragJustFinished = false;

    window.addEventListener('mouseup', (e) => {
      if (!this.enabled) return;
      if (e.button !== 0) return;
      if (!e.isTrusted) return; // 합성 이벤트 차단
      if (this.isGoogleDocsHost()) return; // 구글 시트: mouseup 차단
      if (!e.shiftKey || !this._shiftAtMouseDown || e.ctrlKey || e.altKey) return;
      if (this.isTypingTarget(e.target)) return;

      const selection = window.getSelection();
      const selectedText = selection ? selection.toString().trim() : '';

      if (selectedText && selectedText.length >= 2) {
        _dragJustFinished = true;
        setTimeout(() => { _dragJustFinished = false; }, 600);
        this.clearSelectionHighlight();
        this.startDragReading(selection, selectedText, e.target);
      }
    }, true);

    // ─────────────────────────────────────────────────────────────────────
    // 2. 클릭 낭독 (click)
    // ─────────────────────────────────────────────────────────────────────
    window.addEventListener('click', (e) => {
      if (!this.enabled) return;
      if (e.button !== 0) return;

      // ★ 합성 이벤트(구글 시트 내부 programmatic click) 완전 차단 ★
      if (!e.isTrusted) return;

      // ── 구글 시트 전용 ──────────────────────────────────────────────
      if (this.isGoogleDocsHost()) {
        // mousedown과 click 양쪽에서 Shift가 true여야만 낭독
        // (둘 중 하나라도 false면 → 일반 셀 이동으로 처리, 낭독 없음)
        if (!e.shiftKey || !this._shiftAtMouseDown) return;

        // 150ms 딜레이: 구글 시트가 DOM 업데이트할 시간 확보
        setTimeout(() => this._readGoogleSheetsCell(), 150);
        return;
      }

      // ── 일반 웹 ────────────────────────────────────────────────────
      if (!e.shiftKey || !this._shiftAtMouseDown || e.ctrlKey || e.altKey) return;
      if (this.isTypingTarget(e.target)) return;
      if (_dragJustFinished) { _dragJustFinished = false; return; }

      const selection = window.getSelection();
      const selectedText = selection ? selection.toString().trim() : '';
      if (selectedText && selectedText.length >= 2) return;

      const clickTarget = e.target;
      if (!clickTarget || this.parser.isHidden(clickTarget)) return;

      const allSegments = this.parser.parse();
      if (!allSegments || allSegments.length === 0) return;

      const targetIndex = this.findExactSegmentIndex(clickTarget, allSegments);
      this.clearSelectionHighlight();
      console.log(`[SoriView] 🎯 Shift+클릭 문단부터 연속 낭독 (인덱스: ${targetIndex})`);
      this.ttsEngine.speakSegments(allSegments, targetIndex);
    }, true);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 구글 시트 셀 텍스트 추출 및 낭독
  // ─────────────────────────────────────────────────────────────────────────

  _readGoogleSheetsCell() {
    const menuKeywords = ['파일', '수정', '보기', '삽입', '서식', '데이터', '도구', 'gemini',
                          '확장 프로그램', '도움말', '공유', '기본값'];
    const isMenu = (txt) => menuKeywords.includes(txt.toLowerCase().trim());

    let cellText = '';
    let cellElement = null;

    // 1) activeElement 우선
    const ae = document.activeElement;
    if (ae && ae !== document.body) {
      const txt = (ae.value || ae.innerText || ae.textContent || '').trim();
      if (txt && !isMenu(txt)) { cellText = txt; cellElement = ae; }
    }

    // 2) 수식 입력줄 / 셀 에디터 후보군 순차 탐색
    if (!cellText) {
      const selectors = [
        '#t-formula-bar-input',
        '.goog-formula-bar-text-div',
        '.formula-content',
        '#waffle-rich-text-editor',
        '.cell-input',
        '.cell-input-inner',
        'textarea.input-box',
        '.grid-input-label',
        '.docs-formula-bar-textbox',
        '[contenteditable="true"]',
        '[role="textbox"]',
        '[role="gridcell"]'
      ];
      for (const sel of selectors) {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          const txt = (el.value || el.innerText || el.textContent || '').trim();
          if (txt && !isMenu(txt)) { cellText = txt; cellElement = el; break; }
        }
        if (cellText) break;
      }
    }

    // 3) 드래그 선택 텍스트
    if (!cellText) {
      try {
        const sel = window.getSelection();
        if (sel) {
          const txt = sel.toString().trim();
          if (txt && !isMenu(txt)) { cellText = txt; cellElement = document.body; }
        }
      } catch (_) {}
    }

    if (!cellText || cellText.length === 0) return;

    console.log('[SoriView] 🎯 구글 시트 Shift+클릭 낭독:', cellText);

    const sentences = this.parser.splitIntoSentences(cellText);
    const segments = sentences.length > 0
      ? sentences.map(s => ({ element: cellElement || document.body, text: s }))
      : [{ element: cellElement || document.body, text: cellText }];

    this.ttsEngine.speakSegments(segments, 0);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 드래그 낭독
  // ─────────────────────────────────────────────────────────────────────────

  startDragReading(selection, selectedText, targetElement) {
    if (!selectedText || selectedText.trim().length < 2) return;
    const cleanText = selectedText.trim();
    this.lastSelectedText = cleanText;
    this.applyNonDestructiveHighlight(selection);

    console.log('[SoriView] 🎯 드래그 영역 낭독:', cleanText);

    const sentences = this.parser.splitIntoSentences(cleanText);
    const dragSegments = sentences.map(s => ({ element: targetElement, text: s }));
    this.ttsEngine.speakSegments(dragSegments, 0);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 세그먼트 인덱스 탐색
  // ─────────────────────────────────────────────────────────────────────────

  findExactSegmentIndex(clickTarget, allSegments) {
    if (!clickTarget || !allSegments || allSegments.length === 0) return 0;

    let index = allSegments.findIndex(seg => seg.element === clickTarget);
    if (index !== -1) return index;

    let curr = clickTarget;
    while (curr && curr !== document.body && curr !== document.documentElement) {
      if (curr.tagName && !['DIV', 'SECTION', 'ARTICLE', 'MAIN', 'BODY', 'HTML'].includes(curr.tagName.toUpperCase())) {
        index = allSegments.findIndex(seg => seg.element === curr);
        if (index !== -1) return index;
      }
      curr = curr.parentElement;
    }

    const clickText = (clickTarget.innerText || clickTarget.textContent || '').trim();
    if (clickText.length >= 2) {
      index = allSegments.findIndex(seg => seg.text && (seg.text.includes(clickText) || clickText.includes(seg.text)));
      if (index !== -1) return index;
    }

    for (let i = 0; i < allSegments.length; i++) {
      if (allSegments[i].element) {
        const pos = clickTarget.compareDocumentPosition(allSegments[i].element);
        if (pos & Node.DOCUMENT_POSITION_FOLLOWING || pos & Node.DOCUMENT_POSITION_CONTAINED_BY) {
          return i;
        }
      }
    }

    return 0;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 하이라이트
  // ─────────────────────────────────────────────────────────────────────────

  applyNonDestructiveHighlight(selection) {
    this.clearSelectionHighlight();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);

    if (window.CSS && CSS.highlights) {
      try {
        const highlight = new Highlight(range);
        CSS.highlights.set('soriview-selection', highlight);
      } catch (e) {
        this.fallbackHighlight(range);
      }
    } else {
      this.fallbackHighlight(range);
    }
  }

  fallbackHighlight(range) {
    const rects = range.getClientRects();
    if (!rects || rects.length === 0) return;

    const overlayContainer = document.createElement('div');
    overlayContainer.className = 'soriview-overlay-container';
    overlayContainer.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483640;';

    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;

    for (let i = 0; i < rects.length; i++) {
      const rect = rects[i];
      if (rect.width === 0 || rect.height === 0) continue;
      const box = document.createElement('div');
      box.style.cssText = `position:absolute;top:${rect.top + scrollY}px;left:${rect.left + scrollX}px;width:${rect.width}px;height:${rect.height}px;background:#FFE600;opacity:0.75;border-radius:3px;box-shadow:0 0 8px #FFE600;mix-blend-mode:multiply;`;
      overlayContainer.appendChild(box);
    }
    document.body.appendChild(overlayContainer);
  }

  clearSelectionHighlight() {
    if (window.CSS && CSS.highlights) {
      try { CSS.highlights.delete('soriview-selection'); } catch (e) {}
    }
    document.querySelectorAll('.soriview-overlay-container').forEach(el => el.remove());
    document.querySelectorAll('.tts-active-segment').forEach(el => el.classList.remove('tts-active-segment'));

    try {
      if (window.top && window.top.document) {
        window.top.document.querySelectorAll('.tts-active-segment, .soriview-overlay-container').forEach(el => {
          if (el.classList.contains('tts-active-segment')) el.classList.remove('tts-active-segment');
          else el.remove();
        });
      }
    } catch (e) {}
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 스팟라이트 돋보기
  // ─────────────────────────────────────────────────────────────────────────

  createSpotlightLensDOM() {
    if (document.getElementById('soriview-spotlight-lens')) {
      this.spotlightLens = document.getElementById('soriview-spotlight-lens');
      return;
    }
    const lens = document.createElement('div');
    lens.id = 'soriview-spotlight-lens';
    lens.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483645;display:none;max-width:420px;padding:12px 18px;background:rgba(0,0,0,0.92);color:#FFE600;border:3px solid #FFE600;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,0.85),0 0 15px rgba(255,230,0,0.6);font-size:24px;font-weight:bold;line-height:1.4;word-break:break-word;transition:opacity 0.15s ease-out;backdrop-filter:blur(4px);';
    lens.innerHTML = `
      <div style="font-size:13px;color:#00FFCC;margin-bottom:4px;font-weight:normal;">🔍 소리뷰 돋보기</div>
      <div id="soriview-lens-text"></div>
    `;
    document.body.appendChild(lens);
    this.spotlightLens = lens;
  }

  showSpotlightLens(clientX, clientY, text) {
    if (!this.spotlightLens) this.createSpotlightLensDOM();
    const textEl = this.spotlightLens.querySelector('#soriview-lens-text');
    if (textEl) textEl.innerText = text.length > 90 ? text.substring(0, 90) + '...' : text;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = clientX + 20;
    let top = clientY + 20;
    if (left + 420 > vw) left = clientX - 440;
    if (left < 10) left = 10;
    if (top + 160 > vh) top = clientY - 180;
    if (top < 10) top = 10;

    this.spotlightLens.style.left = `${left}px`;
    this.spotlightLens.style.top = `${top}px`;
    this.spotlightLens.style.display = 'block';
    this.spotlightLens.style.opacity = '1';
  }

  hideSpotlightLens() {
    if (this.spotlightLens) {
      this.spotlightLens.style.opacity = '0';
      this.spotlightLens.style.display = 'none';
    }
  }
};
