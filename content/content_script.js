/**
 * content/content_script.js - 소리뷰(SoriView) 메인 콘텐츠 스크립트 오케스트레이터
 * 1. e.repeat 키 반복 입력 차단으로 Ctrl+Space 연타/지연 스터터링 100% 제거
 * 2. 낭독 상태 시각적 HUD 토스트 알림(⏸️ 일시정지 / ▶️ 이어서 낭독) 탑재
 */

(function () {
  if (window.__soriViewInjected) return;
  window.__soriViewInjected = true;

  console.log('[SoriView] 메인 낭독 엔진 초기화 완료.');

  // 구글 시트 전용 진단 및 셀 구조 파악 로거
  if (window.location.hostname.includes('docs.google.com')) {
    console.log('[SoriView-Sheets-Diag] 구글 시트 전용 낭독 레이어 활성화됨.');
    window.__soriViewDebugSheets = () => {
      const activeEl = document.activeElement;
      const formulaEl = document.querySelector('#t-formula-bar-input, .goog-formula-bar-text-div, #waffle-rich-text-editor, .cell-input');
      const ariaCells = document.querySelectorAll('[role="gridcell"], .aria-aria-gridcell, .docs-aria-speakable');
      const info = {
        activeElementTag: activeEl ? activeEl.tagName : null,
        activeElementText: activeEl ? (activeEl.value || activeEl.innerText || activeEl.textContent) : null,
        formulaBarText: formulaEl ? (formulaEl.innerText || formulaEl.textContent || formulaEl.value) : null,
        ariaCellsCount: ariaCells.length,
        selectionText: window.getSelection() ? window.getSelection().toString() : ''
      };
      console.log('[SoriView-Sheets-Diag Result]', info);
      return info;
    };
  }

  const parser = new window.SemanticDOMParser();
  const ttsEngine = new window.TTSEngine();
  const hoverSpeaker = new window.HoverSpeaker(ttsEngine, parser);
  const readerOverlay = new window.ReaderOverlay(ttsEngine);

  // 네이버 블로그 등 마우스 드래그/선택 차단 해제 (핀포인트 드래그 낭독 보장)
  function unblockTextSelection() {
    try {
      const style = document.createElement('style');
      style.id = 'soriview-unblock-selection';
      style.innerHTML = `
        * {
          -webkit-user-select: text !important;
          -moz-user-select: text !important;
          -ms-user-select: text !important;
          user-select: text !important;
        }
      `;
      if (!document.getElementById('soriview-unblock-selection')) {
        (document.head || document.documentElement).appendChild(style);
      }
      document.addEventListener('selectstart', (e) => e.stopPropagation(), true);
    } catch (e) {}
  }
  unblockTextSelection();

  let activeHighlightElement = null;

  // 1. 초기 설정 로드
  chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (response) => {
    if (response && response.settings) {
      applySettings(response.settings);
    }
  });

  function applySettings(settings) {
    ttsEngine.updateSettings(settings);
    hoverSpeaker.setEnabled(settings.hoverSpeak);
  }

  // 화면 중앙 시각적 HUD 토스트 팝업 (저시력자 직관적 알림)
  function showToastHUD(message, isPaused) {
    let toast = document.getElementById('soriview-toast-hud');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'soriview-toast-hud';
      toast.style.position = 'fixed';
      toast.style.top = '20%';
      toast.style.left = '50%';
      toast.style.transform = 'translate(-50%, -50%)';
      toast.style.padding = '16px 32px';
      toast.style.borderRadius = '12px';
      toast.style.fontSize = '22px';
      toast.style.fontWeight = 'bold';
      toast.style.color = '#FFFFFF';
      toast.style.zIndex = '2147483647';
      toast.style.boxShadow = '0 8px 32px rgba(0,0,0,0.8)';
      toast.style.transition = 'all 0.2s ease-in-out';
      toast.style.pointerEvents = 'none';
      document.body.appendChild(toast);
    }

    toast.style.backgroundColor = isPaused ? 'rgba(230, 0, 0, 0.9)' : 'rgba(0, 180, 80, 0.9)';
    toast.style.border = isPaused ? '3px solid #FF4444' : '3px solid #00FFCC';
    toast.innerText = message;
    toast.style.opacity = '1';

    if (window.__toastTimer) clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(() => {
      if (toast) toast.style.opacity = '0';
    }, 1200);
  }

  // 2. TTS 콜백 이벤트 연결
  ttsEngine.onSegmentChangeCallback = (segment, index) => {
    const activeElements = document.querySelectorAll('.tts-active-segment');
    activeElements.forEach(el => el.classList.remove('tts-active-segment'));

    if (segment && segment.element) {
      let el = segment.element;

      // 구글 시트 상단 메뉴/도구모음 요소(Gemini 등)는 하이라이팅 및 낭독 대상에서 완전 제외
      if (window.location.hostname.includes('docs.google.com')) {
        if (el.closest && el.closest('#docs-header, #docs-chrome, .docs-menubar, .goog-menubar, .docs-titlebar, .docs-material-header, #docs-toolbar-wrapper, .goog-toolbar')) {
          if (el.id !== 't-formula-bar-input' && !el.classList.contains('goog-formula-bar-text-div')) {
            return;
          }
        }
      }

      // 거대 상위 컨테이너 노드가 들어온 경우 내부 하위 핀포인트 p, span 노드로 즉시 축소
      const rawTag = el.tagName ? el.tagName.toUpperCase() : '';
      if (['DIV', 'SECTION', 'ARTICLE', 'HEADER', 'MAIN', 'BODY', 'HTML'].includes(rawTag)) {
        const pinpointChild = el.querySelector('.se-text-paragraph, span.se-fs-, p, span, h1, h2, h3, h4, h5, h6');
        if (pinpointChild) {
          el = pinpointChild;
        }
      }

      const tagName = el.tagName ? el.tagName.toUpperCase() : '';
      const isContainer = ['DIV', 'SECTION', 'ARTICLE', 'MAIN', 'BODY', 'HTML', 'TABLE', 'TBODY', 'THEAD', 'TR', 'UL', 'OL', 'FORM', 'NAV', 'HEADER', 'FOOTER'].includes(tagName);
      
      if (!isContainer) {
        const rect = el.getBoundingClientRect();
        const isHugeBox = (rect.width > window.innerWidth * 0.95 && rect.height > window.innerHeight * 0.6);
        
        if (!isHugeBox) {
          activeHighlightElement = el;
          activeHighlightElement.classList.add('tts-active-segment');
          activeHighlightElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }

    if (readerOverlay.isOpen) {
      readerOverlay.highlightActiveParagraph(index);
    }
  };

  // 3. 웹페이지 단축키 이벤트 수신기 (e.repeat 100% 차단으로 스페이스바 중복 토글 제거)
  window.addEventListener('keydown', (e) => {
    // Chrome 브라우저 내장 ESC 낭독 취소 동작 100% 차단 (ESC 눌러도 낭독 멈추지 않음)
    if (e.key === 'Escape' || e.code === 'Escape' || e.keyCode === 27) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      return false;
    }

    // 키 누르고 있을 때의 자동 반복 연타(e.repeat) 100% 차단!
    if (e.repeat) return;

    const activeElement = document.activeElement;
    const isTyping = Boolean(
      activeElement &&
      (
        ['input', 'textarea', 'select'].includes(activeElement.tagName ? activeElement.tagName.toLowerCase() : '') ||
        activeElement.isContentEditable ||
        (activeElement.closest && activeElement.closest('input, textarea, select, [contenteditable="true"]'))
      )
    );

    // 1) F2 키: 언제 어디서든 낭독 100% 강제 정지 & 모든 하이라이팅 즉시 초기화 (F2 전용)
    const isF2 = Boolean(
      (e.key && e.key.toUpperCase() === 'F2') ||
      (e.code && e.code.toUpperCase() === 'F2') ||
      e.keyCode === 113 ||
      e.which === 113
    );

    if (isF2) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      ttsEngine.stop();
      hoverSpeaker.clearSelectionHighlight();

      if (readerOverlay.isOpen) {
        readerOverlay.close();
      }

      const activeElements = document.querySelectorAll('.tts-active-segment');
      activeElements.forEach(el => el.classList.remove('tts-active-segment'));
      activeHighlightElement = null;

      showToastHUD('⏹️ 낭독 완전 정지 (F2)', true);
      console.log('[SoriView] 🛑 F2 키로 낭독 100% 강제 정지 완료.');
      return false;
    }

    // 입력창에서 글을 쓸 때(대문자, 기호 등 Shift 사용 시) 일반 입력 모드로 판단.
    // 단, 노션(Notion) 및 구글 시트 등 특수 웹 앱에서는 블록 포커스 상태에서도 TTS 조작 단축키(Ctrl+Space, Shift+방향키, Shift+H) 허용
    const isNotion = window.location.hostname.includes('notion.so') ||
                     window.location.hostname.includes('notion.site') ||
                     Boolean(document.querySelector('.notion-page-content, .notion-frame'));

    const isGoogleDocs = window.location.hostname.includes('docs.google.com');

    const isTTSShortcut = Boolean(
      (e.ctrlKey && !e.shiftKey && !e.altKey && (e.code === 'Space' || e.key === ' ' || e.keyCode === 32)) ||
      (e.shiftKey && !e.ctrlKey && (e.code === 'ArrowRight' || e.key === 'ArrowRight' || e.code === 'ArrowLeft' || e.key === 'ArrowLeft')) ||
      (e.shiftKey && (e.code === 'KeyH' || e.key === 'h' || e.key === 'H'))
    );

    if (isTyping) {
      if ((isNotion || isGoogleDocs) && isTTSShortcut) {
        // Notion / Google Docs 환경의 TTS 단축키 통과 허용
      } else {
        return;
      }
    }

    // 2) Ctrl+Space: 오직 Ctrl+Space 조합만 일시정지/재개 (다른 키 조합 제외)
    if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.code === 'Space' || e.key === ' ' || e.keyCode === 32)) {
      e.preventDefault();
      e.stopPropagation();

      const state = ttsEngine.togglePauseResume();
      if (state === 'PAUSED') {
        showToastHUD('⏸️ 낭독 일시정지', true);
      } else if (state === 'RESUMED') {
        showToastHUD('▶️ 이어서 낭독', false);
      } else if (state === 'NONE') {
        showToastHUD('ℹ️ Shift+클릭으로 낭독을 시작하세요', false);
      }
      return;
    }

    // 3) Shift + ➔ / ⬅: 문장 단위 건너뛰기
    if (e.shiftKey && !e.ctrlKey && (e.code === 'ArrowRight' || e.key === 'ArrowRight')) {
      e.preventDefault();
      e.stopPropagation();
      ttsEngine.next();
      showToastHUD('⏭️ 다음 문장', false);
      return;
    }

    if (e.shiftKey && !e.ctrlKey && (e.code === 'ArrowLeft' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      e.stopPropagation();
      ttsEngine.previous();
      showToastHUD('⏮️ 이전 문장', false);
      return;
    }

    // 4) Shift + H (다음 제목) / Shift + Alt + H (이전 제목): 헤딩 목차 탐색 낭독
    if (e.shiftKey && (e.code === 'KeyH' || e.key === 'h' || e.key === 'H')) {
      e.preventDefault();
      e.stopPropagation();
      if (e.altKey) {
        navigateToHeading('prev');
      } else {
        navigateToHeading('next');
      }
      return;
    }
  }, true);

  function navigateToHeading(direction = 'next') {
    const segments = parser.parse();
    if (!segments || segments.length === 0) {
      showToastHUD('⚠️ 페이지 본문을 찾을 수 없습니다', true);
      return;
    }

    const headingIndices = [];
    segments.forEach((seg, idx) => {
      if (seg.element) {
        const tag = seg.element.tagName ? seg.element.tagName.toUpperCase() : '';
        const isHeadingTag = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(tag);
        const isNotionHeading = Boolean(
          (seg.element.classList && (seg.element.classList.contains('notion-header-block') || seg.element.classList.contains('notion-sub_header-block') || seg.element.classList.contains('notion-sub_sub_header-block'))) ||
          (seg.element.closest && seg.element.closest('h1, h2, h3, h4, h5, h6, .notion-header-block, .notion-sub_header-block, .notion-sub_sub_header-block'))
        );

        if (isHeadingTag || isNotionHeading) {
          if (headingIndices.length === 0 || headingIndices[headingIndices.length - 1] !== idx) {
            headingIndices.push(idx);
          }
        }
      }
    });

    if (headingIndices.length === 0) {
      showToastHUD('⚠️ 헤딩(제목) 목차가 없는 페이지입니다', true);
      return;
    }

    const currentIdx = ttsEngine.currentIndex || 0;
    let targetIdx = -1;

    if (direction === 'next') {
      targetIdx = headingIndices.find(idx => idx > currentIdx);
      if (targetIdx === undefined) targetIdx = headingIndices[0];
    } else {
      const prevs = headingIndices.filter(idx => idx < currentIdx);
      if (prevs.length > 0) targetIdx = prevs[prevs.length - 1];
      else targetIdx = headingIndices[headingIndices.length - 1];
    }

    const headingSeg = segments[targetIdx];
    const rawText = headingSeg ? headingSeg.text : '';
    const headingText = rawText.length > 18 ? rawText.substring(0, 18) + '...' : rawText;

    showToastHUD(`🏷️ [제목 목차]: "${headingText}"`, false);
    console.log(`[SoriView] 🏷️ 헤딩 이동 (${direction}): 문장 인덱스 ${targetIdx}`);
    ttsEngine.speakSegments(segments, targetIdx);
  }

  function startFullPageReading() {
    const segments = parser.parse();
    if (!segments || segments.length === 0) return;

    // top 프레임과 iframe 간 중복 발화 방지 (top 프레임이 처리 가능한 경우 위임)
    if (window.self !== window.top) {
      try {
        if (window.parent && window.parent.document && window.parent.document.querySelector('iframe#mainFrame, iframe#papermain')) {
          const topSegments = new window.SemanticDOMParser().parse(window.parent.document.body);
          if (topSegments && topSegments.length > 0) {
            console.log('[SoriView] top 프레임 낭독 엔진으로 실행 위임.');
            return;
          }
        }
      } catch (e) {
        // Cross-origin iframe fallback
      }
    }

    ttsEngine.speakSegments(segments, 0);
  }

  // 4. 브릿지 메시지 수신기
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'READ_FULL_PAGE': {
        startFullPageReading();
        sendResponse({ success: true });
        break;
      }

      case 'TOGGLE_READER_VIEW': {
        if (readerOverlay.isOpen) {
          readerOverlay.close();
        } else {
          const segments = parser.parse();
          readerOverlay.open(segments);
        }
        sendResponse({ isOpen: readerOverlay.isOpen });
        break;
      }

      case 'READ_CUSTOM_TEXT': {
        if (message.text && message.text.trim()) {
          ttsEngine.speakSingleText(message.text.trim());
        }
        sendResponse({ success: true });
        break;
      }

      case 'STOP_READING': {
        ttsEngine.stop();
        hoverSpeaker.clearSelectionHighlight();
        hoverSpeaker.hideSpotlightLens();
        try { window.speechSynthesis.cancel(); } catch (e) {}
        if (readerOverlay.isOpen) {
          readerOverlay.close();
        }
        const activeElements = document.querySelectorAll('.tts-active-segment');
        activeElements.forEach(el => el.classList.remove('tts-active-segment'));
        activeHighlightElement = null;
        sendResponse({ success: true });
        break;
      }

      case 'SETTINGS_UPDATED': {
        applySettings(message.settings);
        sendResponse({ success: true });
        break;
      }

      default:
        break;
    }
  });
})();
