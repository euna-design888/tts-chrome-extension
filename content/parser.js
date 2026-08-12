/**
 * content/parser.js - 자연스러운 의미론적 DOM 파서
 * - 텍스트를 끊김 없는 자연스러운 전체 문장(.!?) 및 줄바꿈(\n) 단위로 파싱하여 100% 매끄러운 낭독 품질 보장
 */

window.SemanticDOMParser = class SemanticDOMParser {
  constructor() {
    this.ignoreTags = new Set([
      'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'SVG', 'CANVAS',
      'NAV', 'HEADER', 'FOOTER', 'ASIDE', 'FORM', 'INPUT'
    ]);

    this.containerTags = new Set([
      'BODY', 'HTML', 'MAIN', 'ARTICLE', 'SECTION', 'TABLE', 'TBODY', 'THEAD', 'TR',
      'UL', 'OL', 'DL', 'FIELDSET', 'FIGURE', 'DIV'
    ]);

    this.leafTags = new Set([
      'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TH', 'TD',
      'PRE', 'CODE', 'SUMMARY', 'TEXTAREA', 'BLOCKQUOTE', 'DT', 'DD'
    ]);
  }

  isHidden(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    if (element.getAttribute('aria-hidden') === 'true') return true;

    const style = window.getComputedStyle(element);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      parseFloat(style.opacity) === 0 ||
      style.clipPath === 'inset(100%)'
    ) {
      return true;
    }
    return false;
  }

  /**
   * 자연스러운 문장 단위 분할 함수
   * - 마침표(.!?), 줄바꿈(\n) 기준으로 문장을 자연스럽게 연결하여 어색한 뚝뚝 끊김 제거
   */
  splitIntoSentences(text) {
    if (!text || text.trim().length === 0) return [];
    const rawSentences = text.split(/(?<=[.!?\n])\s+/);
    return rawSentences.map(s => s.trim()).filter(s => s.length > 0);
  }

  normalizeOrphanTextNodes(root) {
    if (!root) return;

    const candidateContainers = Array.from(root.querySelectorAll('article, section, main, div, [role="main"]'));
    if (this.containerTags.has(root.tagName.toUpperCase())) {
      candidateContainers.unshift(root);
    }

    candidateContainers.forEach(container => {
      if (this.isHidden(container)) return;

      const childNodes = Array.from(container.childNodes);
      if (childNodes.length === 0) return;

      const hasDirectTextOrBr = childNodes.some(node =>
        (node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0) ||
        (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'BR')
      );

      if (!hasDirectTextOrBr) return;

      let currentGroup = [];

      const flushGroup = () => {
        if (currentGroup.length === 0) return;

        const hasText = currentGroup.some(n => (n.textContent || '').trim().length > 0);
        if (hasText) {
          if (currentGroup.length === 1 && currentGroup[0].nodeType === Node.ELEMENT_NODE) {
            const el = currentGroup[0];
            if (this.leafTags.has(el.tagName) || el.classList.contains('soriview-segment')) {
              currentGroup = [];
              return;
            }
          }

          const firstNode = currentGroup[0];
          const span = document.createElement('span');
          span.className = 'soriview-segment';
          container.insertBefore(span, firstNode);

          currentGroup.forEach(n => {
            span.appendChild(n);
          });
        }
        currentGroup = [];
      };

      childNodes.forEach(child => {
        if (child.nodeType === Node.ELEMENT_NODE) {
          const tag = child.tagName.toUpperCase();
          if (tag === 'BR' || this.leafTags.has(tag) || this.containerTags.has(tag)) {
            flushGroup();
          } else {
            currentGroup.push(child);
          }
        } else if (child.nodeType === Node.TEXT_NODE) {
          currentGroup.push(child);
        }
      });

      flushGroup();
    });
  }

  parseGoogleSheets(targetRoot = document.body) {
    const results = [];
    const addedTexts = new Set();

    const isTopMenuElement = (el) => {
      if (!el || !el.closest) return false;
      // 수식 입력줄(Formula Bar) 및 셀 에디터 자체는 허용
      if (
        el.id === 't-formula-bar-input' ||
        el.id === 'waffle-rich-text-editor' ||
        (el.classList && (el.classList.contains('goog-formula-bar-text-div') || el.classList.contains('formula-content') || el.classList.contains('cell-input')))
      ) {
        return false;
      }
      // 메뉴바, 도구모음, 뷰어 헤더, 상단 버튼군 안의 요소는 상단 배너/메뉴로 판단하여 강력 차단
      const menuParent = el.closest(
        '#docs-header, #docs-chrome, .docs-menubar, .goog-menubar, .docs-titlebar, .docs-material-header, #docs-toolbar-wrapper, .goog-toolbar, .docs-titlebar-buttons'
      );
      if (menuParent) return true;
      return false;
    };

    const addSegment = (el, rawText) => {
      if (!rawText) return;
      const clean = rawText.trim();
      if (clean.length < 2) return;
      
      // 상단 메뉴버튼 요소 차단
      if (isTopMenuElement(el)) return;

      const menuKeywords = ['파일', '수정', '보기', '삽입', '서식', '데이터', '도구', 'gemini', '확장 프로그램', '도움말', '공유', '기본값'];
      if (menuKeywords.includes(clean.toLowerCase())) return;

      if (!addedTexts.has(clean)) {
        addedTexts.add(clean);
        const sentences = this.splitIntoSentences(clean);
        if (sentences.length > 0) {
          sentences.forEach(s => results.push({ element: el || document.body, text: s }));
        } else {
          results.push({ element: el || document.body, text: clean });
        }
      }
    };

    // 1. 수식 입력줄 (Formula Bar) 및 현재 선택된 셀 (Waffle Rich Text Editor / Cell Input)
    const formulaSelectors = [
      '#t-formula-bar-input',
      '#waffle-rich-text-editor',
      '.goog-formula-bar-text-div',
      '.formula-content',
      '.cell-input',
      '.cell-input-inner',
      'textarea.input-box',
      '.grid-input-label',
      '.docs-formula-bar-textbox',
      '#formula-bar',
      '[aria-label*="수식"]',
      '[aria-label*="Formula"]'
    ];

    formulaSelectors.forEach(sel => {
      const els = targetRoot.querySelectorAll(sel);
      els.forEach(el => {
        const text = (el.value || el.innerText || el.textContent || '').trim();
        addSegment(el, text);
      });
    });

    // 2. 현재 포커스된 activeElement
    if (document.activeElement) {
      const actEl = document.activeElement;
      const actText = (actEl.value || actEl.innerText || actEl.textContent || '').trim();
      addSegment(actEl, actText);
    }

    // 3. 접근성 Gridcell & Row & Aria Speakable 영역
    const gridSelectors = [
      '[role="gridcell"]',
      '[role="cell"]',
      '[role="row"]',
      '.aria-aria-gridcell',
      '.docs-aria-speakable',
      '.grid-scrollable-wrapper [role="row"]'
    ];

    gridSelectors.forEach(sel => {
      const els = targetRoot.querySelectorAll(sel);
      els.forEach(el => {
        const text = (el.innerText || el.textContent || '').trim();
        addSegment(el, text);
      });
    });

    // 4. 선택 영역 텍스트 (Drag / Selection)
    try {
      const sel = window.getSelection();
      if (sel) {
        const selText = sel.toString().trim();
        if (selText) addSegment(document.body, selText);
      }
    } catch (e) {}

    // 5. 문서 제목 (예: "인공지능 쇼츠")
    const titleEl = targetRoot.querySelector('.docs-title-input, .docs-title-inner, #docs-title-widget');
    if (titleEl) {
      const titleText = (titleEl.value || titleEl.innerText || titleEl.textContent || '').trim();
      addSegment(titleEl, titleText);
    }

    return results;
  }

  parseNotion(targetRoot = document.body) {
    const results = [];
    const addedTexts = new Set();

    const isUIElement = (el) => {
      if (!el || !el.closest) return false;
      return Boolean(el.closest('.notion-sidebar, .notion-topbar, .notion-help-button, .notion-frame-header, .notion-modal, .notion-overlay-container, .notion-peek-renderer-header'));
    };

    // 1. 노션 본문 루트 컨테이너
    const pageContainer = targetRoot.querySelector('.notion-page-content, .notion-scroller, .notion-frame, .notion-page-view, .notion-app-inner') || targetRoot;

    // 2. 노션 내 텍스트 보유 후보 셀렉터 전수 수집
    const candidates = Array.from(pageContainer.querySelectorAll(
      '[data-block-id], .notion-selectable, .notion-semantic-string, [contenteditable="true"], [contenteditable="false"], .notion-text-block, .notion-header-block, .notion-sub_header-block, .notion-sub_sub_header-block, .notion-callout-block, .notion-quote-block, .notion-bulleted_list-block, .notion-numbered_list-block, .notion-to_do-block, .notion-toggle-block, .notion-code-block, h1, h2, h3, h4, h5, h6, p, [role="textbox"], [role="option"]'
    ));

    // 유효한 비어있지 않은 후보 요소 1차 필터링
    const validCandidates = candidates.filter(el => {
      if (this.isHidden(el) || isUIElement(el)) return false;
      const txt = (el.innerText || el.textContent || '').trim();
      if (!txt || txt.length === 0) return false;

      // 노션 기본 플레이스홀더 문구 제외
      const placeholders = ["Type '/' for commands", "Press '/' for commands", "Untitled", "제목 없음"];
      if (placeholders.includes(txt)) return false;

      return true;
    });

    // 3. 하위에 더 구체적인 텍스트 후보 자식 요소가 존재하는 상위 부모 요소 제거 (가장 하위 핀포인트 리프 노드만 유지)
    const leafElements = validCandidates.filter(parent => {
      const parentTxt = (parent.innerText || parent.textContent || '').trim();

      const hasChildCandidate = validCandidates.some(child => {
        if (child === parent) return false;
        if (parent.contains(child)) {
          const childTxt = (child.innerText || child.textContent || '').trim();
          if (childTxt.length > 0 && parentTxt.includes(childTxt)) {
            return true;
          }
        }
        return false;
      });

      return !hasChildCandidate;
    });

    // 4. 수집된 최하위 리프 요소들로부터 텍스트 문장 분할 및 세그먼트 생성
    leafElements.forEach(el => {
      const rawText = (el.innerText || el.textContent || '').trim();
      if (!rawText) return;

      if (!addedTexts.has(rawText)) {
        addedTexts.add(rawText);
        const sentences = this.splitIntoSentences(rawText);

        // 노션 시각적 하이라이팅을 위한 가장 가까운 블록 부모 지정
        const blockParent = el.closest && el.closest('[data-block-id], .notion-selectable, .notion-text-block, .notion-header-block, .notion-callout-block, .notion-quote-block, .notion-bulleted_list-block') ? el.closest('[data-block-id], .notion-selectable, .notion-text-block, .notion-header-block, .notion-callout-block, .notion-quote-block, .notion-bulleted_list-block') : el;

        if (sentences.length > 0) {
          sentences.forEach(s => {
            results.push({ element: blockParent, text: s });
          });
        } else {
          results.push({ element: blockParent, text: rawText });
        }
      }
    });

    // 5. 최후의 보루: leafElements가 0개일 경우 pageContainer의 모든 텍스트 노드 강제 수집
    if (results.length === 0) {
      const allTextEls = Array.from(pageContainer.querySelectorAll('div, span, p, h1, h2, h3, h4, h5, h6'))
        .filter(el => !this.isHidden(el) && !isUIElement(el) && (el.innerText || el.textContent || '').trim().length > 0);

      allTextEls.forEach(el => {
        const text = (el.innerText || el.textContent || '').trim();
        if (text && !addedTexts.has(text)) {
          addedTexts.add(text);
          const sentences = this.splitIntoSentences(text);
          sentences.forEach(s => results.push({ element: el, text: s }));
        }
      });
    }

    return results;
  }

  parse(rootElement = document.body) {
    // 노션(Notion) 전용 핀포인트 파싱
    const isNotion = window.location.hostname.includes('notion.so') ||
                     window.location.hostname.includes('notion.site') ||
                     Boolean(document.querySelector('.notion-page-content, .notion-frame, .notion-app-inner'));

    if (isNotion) {
      const notionResults = this.parseNotion(rootElement);
      if (notionResults.length > 0) {
        return notionResults;
      }
    }

    // 구글 시트(Google Sheets) 전용 핀포인트 파싱
    if (window.location.hostname.includes('docs.google.com')) {
      const gsheetResults = this.parseGoogleSheets(rootElement);
      if (gsheetResults.length > 0) {
        return gsheetResults;
      }
    }

    const results = [];
    
    // 1) 네이버 블로그 등 iframe 구조 웹사이트 탐색 지원 (#mainFrame)
    let targetRoot = rootElement;
    const blogIframe = rootElement.querySelector('iframe#mainFrame, iframe#papermain, iframe.blog-iframe');
    if (blogIframe && blogIframe.contentDocument && blogIframe.contentDocument.body) {
      try {
        const iframeBody = blogIframe.contentDocument.body;
        if (iframeBody.innerText && iframeBody.innerText.trim().length > 20) {
          targetRoot = iframeBody;
        }
      } catch (e) {
        // Cross-origin iframe fallback (all_frames handles it)
      }
    }

    // 네이버 블로그 SmartEditor ONE / 3.0 / 노션(Notion) / 티스토리 / 일반 웹사이트 본문 컨테이너 검색
    const mainContainer = targetRoot.querySelector(
      '.notion-page-content, .notion-scroller, .notion-frame, .notion-page-view, .se-main-container, .se_doc_viewer, #postViewArea, #post-view-search-node, .post-view, #content-area, article, main, [role="main"]'
    ) || targetRoot;

    this.normalizeOrphanTextNodes(mainContainer);

    const isSemanticLeafNode = (node) => {
      if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
      const tagName = node.tagName.toUpperCase();

      const className = typeof node.className === 'string' ? node.className : '';
      const isNotion = window.location.hostname.includes('notion.so') ||
                       window.location.hostname.includes('notion.site') ||
                       Boolean(document.querySelector('.notion-page-content, .notion-frame'));

      if (isNotion) {
        const isNotionBlock = node.hasAttribute('data-block-id') ||
                              className.includes('notion-selectable') ||
                              className.includes('notion-text-block') ||
                              className.includes('notion-header-block') ||
                              className.includes('notion-sub_header-block') ||
                              className.includes('notion-sub_sub_header-block') ||
                              className.includes('notion-callout-block') ||
                              className.includes('notion-quote-block') ||
                              className.includes('notion-bulleted_list-block') ||
                              className.includes('notion-numbered_list-block') ||
                              className.includes('notion-to_do-block') ||
                              className.includes('notion-toggle-block') ||
                              className.includes('notion-code-block') ||
                              className.includes('notion-table-row');

        if (isNotionBlock) {
          const hasChildBlock = node.querySelector('[data-block-id], .notion-selectable, .notion-text-block, .notion-header-block');
          if (!hasChildBlock) {
            return true;
          }
        }
      }

      // DIV나 SECTION 같은 상위 레이아웃 컨테이너는 절대 일반 리프 노드로 취급하지 않음 (하위 p, span 핀포인트 파싱 강제)
      if (['DIV', 'SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'FOOTER', 'UL', 'OL'].includes(tagName)) {
        return false;
      }

      if (this.leafTags.has(tagName) || node.classList.contains('soriview-segment')) return true;

      // 네이버 블로그 SmartEditor 전용 문단/제목 실질 태그(P, SPAN) 감지
      if (
        (className.includes('se-text-paragraph') || className.includes('se-title-text') || className.includes('se_paragraph') || className.includes('se_title')) &&
        (tagName === 'P' || tagName === 'SPAN')
      ) {
        return true;
      }
      return false;
    };

    const traverse = (node) => {
      if (!node || node.nodeType !== Node.ELEMENT_NODE) return;
      if (this.ignoreTags.has(node.tagName) || this.isHidden(node)) return;

      const classAndId = (node.className + ' ' + node.id).toLowerCase();
      if (
        classAndId.includes('ad-') ||
        classAndId.includes('banner') ||
        classAndId.includes('sponsor') ||
        classAndId.includes('docs-menubar') ||
        classAndId.includes('docs-titlebar-buttons') ||
        classAndId.includes('notion-sidebar') ||
        classAndId.includes('notion-topbar') ||
        classAndId.includes('notion-help-button') ||
        classAndId.includes('notion-frame-header') ||
        classAndId.includes('notion-modal')
      ) {
        return;
      }

      const isLeafTag = isSemanticLeafNode(node);
      const hasChildren = node.children.length > 0;

      if (hasChildren && !isLeafTag) {
        for (const child of node.children) {
          traverse(child);
        }
        return;
      }

      const text = (node.innerText || node.textContent || '').trim();
      if (text.length >= 1) {
        const sentences = this.splitIntoSentences(text);
        if (sentences.length > 0) {
          sentences.forEach(sentenceText => {
            results.push({ element: node, text: sentenceText });
          });
        } else {
          results.push({ element: node, text });
        }
      }
    };

    traverse(mainContainer);

    // 구글 시트(Google Sheets) 전용 수식 입력줄(Formula Bar) 및 선택 셀 텍스트 감지 보강
    if (window.location.hostname.includes('docs.google.com')) {
      const formulaBar = targetRoot.querySelector('.goog-formula-bar-text-div, #formula-bar, .cell-input, [role="combobox"], .docs-formula-bar-textbox, #t-formula-bar-input');
      if (formulaBar) {
        const text = (formulaBar.innerText || formulaBar.textContent || formulaBar.value || '').trim();
        if (text.length > 0) {
          const sentences = this.splitIntoSentences(text);
          sentences.forEach(s => results.push({ element: formulaBar, text: s }));
        }
      }
    }

    if (results.length === 0) {
      const elements = Array.from(targetRoot.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, th, td, pre, code, summary, blockquote, textarea, .se-text-paragraph, .se-title-text, .goog-formula-bar-text-div'))
        .filter(p => !this.isHidden(p) && (p.innerText || p.textContent).trim().length > 0);
      
      elements.forEach(p => {
        const sentences = this.splitIntoSentences((p.innerText || p.textContent).trim());
        sentences.forEach(s => results.push({ element: p, text: s }));
      });
    }

    return results;
  }
};
