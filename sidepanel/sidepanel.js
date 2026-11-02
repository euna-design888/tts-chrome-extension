/**
 * sidepanel.js - 소리뷰(SoriView) 크롬 사이드바 컨트롤러 UI 및 전천후 TTS 로직
 * - 오른쪽 사이드바 고정(Pin) 환경 지원
 * - 사이드바 바깥 영역 클릭 / 타 탭 이동 시에도 낭독 100% 지속 유지
 * - 낭독 진행 중 버튼 붉은색(Red) 시각 상태 토글 지원
 */

document.addEventListener('DOMContentLoaded', () => {
  const btnReadPage = document.getElementById('btn-read-page');
  const btnToggleReader = document.getElementById('btn-toggle-reader');
  const btnStopReading = document.getElementById('btn-stop-reading');
  const btnReadCustom = document.getElementById('btn-read-custom');
  const btnPasteRead = document.getElementById('btn-paste-read');
  const txtCustomInput = document.getElementById('txt-custom-input');
  const selectVoice = document.getElementById('select-voice');
  const chkHoverSpeak = document.getElementById('chk-hover-speak');
  const sliderRate = document.getElementById('slider-rate');
  const sliderPitch = document.getElementById('slider-pitch');
  const sliderVolume = document.getElementById('slider-volume');
  const valRate = document.getElementById('val-rate');
  const valPitch = document.getElementById('val-pitch');
  const valVolume = document.getElementById('val-volume');

  let currentSettings = {
    rate: 1.0,
    pitch: 1.0,
    volume: 1.0,
    lang: 'ko-KR',
    voiceName: 'Google 한국어',
    hoverSpeak: true
  };

  let sidepanelSpeaking = false;
  let activeSidepanelUtterances = new Set();
  let sidepanelWatchdogTimer = null;
  let sidepanelSafetyTimeoutTimer = null;
  let restartSidepanelChunk = null; // 낭독 중 속도 변경 시 현재 문장을 새 속도로 다시 읽는 훅

  function stopSidepanelWatchdog() {
    if (sidepanelWatchdogTimer) {
      clearInterval(sidepanelWatchdogTimer);
      sidepanelWatchdogTimer = null;
    }
  }

  function clearSidepanelSafetyTimeout() {
    if (sidepanelSafetyTimeoutTimer) {
      clearTimeout(sidepanelSafetyTimeoutTimer);
      sidepanelSafetyTimeoutTimer = null;
    }
  }

  // 낭독 진행 상태에 따른 버튼 붉은색(Red) 시각적 피드백 토글
  function setSpeakingUI(isSpeaking) {
    if (!btnReadCustom) return;
    if (isSpeaking) {
      btnReadCustom.classList.add('btn-speaking');
      btnReadCustom.innerHTML = '🔊 낭독 진행 중... (클릭 시 정지)';
    } else {
      btnReadCustom.classList.remove('btn-speaking');
      btnReadCustom.innerHTML = '▶️ 즉시 낭독 시작';
    }
  }

  // 1. 한국어(1순위) & 영어(2순위) 최고 품질 AI 음성 TOP 5 지정
  function loadTop5VoiceList() {
    const voices = window.speechSynthesis.getVoices();
    if (!voices || voices.length === 0) return;

    selectVoice.innerHTML = '';
    const top5Voices = [];

    // [1] Google 한국어 (1순위 기본)
    const googleKorean = voices.find(v => (v.lang.includes('ko') || v.lang.includes('KO')) && v.name.includes('Google'));
    if (googleKorean) {
      top5Voices.push({ voice: googleKorean, label: '🌟 [고품질 AI] Google 한국어 (기본 지정)' });
    }

    // [2] 한국어 여성 AI 성우 (Sun-Hi)
    const sunHiKorean = voices.find(v => (v.lang.includes('ko') || v.lang.includes('KO')) && (v.name.includes('Sun-Hi') || v.name.includes('SunHi') || v.name.includes('Natural')));
    if (sunHiKorean && !top5Voices.some(i => i.voice.name === sunHiKorean.name)) {
      top5Voices.push({ voice: sunHiKorean, label: '✨ [AI 여성 성우] Sun-Hi (자연스러운 한국어)' });
    }

    // [3] 한국어 여성 AI 성우 (Heami)
    const heamiKorean = voices.find(v => (v.lang.includes('ko') || v.lang.includes('KO')) && v.name.includes('Heami'));
    if (heamiKorean && !top5Voices.some(i => i.voice.name === heamiKorean.name)) {
      top5Voices.push({ voice: heamiKorean, label: '👩 [AI 여성 성우] Heami (한국어 여성)' });
    }

    // [4] 한국어 남성 AI 성우 (InJoon)
    const maleKorean = voices.find(v => (v.lang.includes('ko') || v.lang.includes('KO')) && (v.name.includes('InJoon') || v.name.includes('BongJin') || v.name.toLowerCase().includes('male')));
    if (maleKorean && !top5Voices.some(i => i.voice.name === maleKorean.name)) {
      top5Voices.push({ voice: maleKorean, label: '👨 [AI 남성 성우] InJoon (한국어 남성)' });
    }

    // [5] 2순위: 미국식 영어 AI 성우
    const englishVoice = voices.find(v => (v.lang.includes('en') || v.lang.includes('EN')) && (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Jenny') || v.name.includes('US')));
    if (englishVoice && !top5Voices.some(i => i.voice.name === englishVoice.name)) {
      top5Voices.push({ voice: englishVoice, label: '🌐 [AI 영어 성우] Natural US English (미국식 영어)' });
    }

    // 5개 미만 시 한국어/영어 음성으로 채우기
    if (top5Voices.length < 5) {
      const extraVoices = voices.filter(v => (v.lang.includes('ko') || v.lang.includes('en')) && !v.name.includes('Desktop') && !top5Voices.some(i => i.voice.name === v.name));
      extraVoices.forEach(v => {
        if (top5Voices.length < 5) {
          const isKo = v.lang.includes('ko');
          const prefix = isKo ? '🇰🇷 [한국어]' : '🇺🇸 [영어]';
          top5Voices.push({ voice: v, label: `${prefix} ${v.name.replace(/Google|Microsoft/gi, '').trim() || v.name}` });
        }
      });
    }

    const finalTop5 = top5Voices.slice(0, 5);

    finalTop5.forEach(item => {
      const option = document.createElement('option');
      option.value = item.voice.name;
      option.innerText = item.label;
      if (currentSettings.voiceName === item.voice.name || (currentSettings.voiceName && currentSettings.voiceName.includes('Google') && item.voice.name.includes('Google') && item.voice.lang.includes('ko'))) {
        option.selected = true;
      }
      selectVoice.appendChild(option);
    });

    if (finalTop5.length > 0 && (!currentSettings.voiceName || currentSettings.voiceName === 'Google 한국어')) {
      const defaultItem = finalTop5.find(item => item.voice.name.includes('Google') && item.voice.lang.includes('ko')) || finalTop5[0];
      currentSettings.voiceName = defaultItem.voice.name;
      selectVoice.value = defaultItem.voice.name;
      saveSettings();
    } else if (currentSettings.voiceName) {
      selectVoice.value = currentSettings.voiceName;
    }
  }

  loadTop5VoiceList();
  if (window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = loadTop5VoiceList;
  }

  // 2. 저장된 설정 로드
  chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (response) => {
    if (response && response.settings) {
      currentSettings = response.settings;
      updateUI();
    }
  });

  function updateUI() {
    sliderRate.value = currentSettings.rate;
    sliderPitch.value = currentSettings.pitch;
    if (sliderVolume) sliderVolume.value = currentSettings.volume !== undefined ? currentSettings.volume : 1.0;

    syncRateUI();
    valPitch.innerText = `${currentSettings.pitch}`;
    if (valVolume) valVolume.innerText = `${Math.round((currentSettings.volume !== undefined ? currentSettings.volume : 1.0) * 100)}%`;

    chkHoverSpeak.checked = currentSettings.hoverSpeak;

    if (currentSettings.voiceName && selectVoice.options.length > 0) {
      selectVoice.value = currentSettings.voiceName;
    }
  }

  function syncRateUI() {
    valRate.innerText = `${currentSettings.rate}x`;
    document.querySelectorAll('.rate-preset').forEach(btn => {
      btn.classList.toggle('active', parseFloat(btn.dataset.rate) === currentSettings.rate);
    });
  }

  // 속도 확정: 저장(콘텐츠 스크립트 엔진은 SETTINGS_UPDATED로 즉시 재시작) + 사이드패널 자체 낭독도 즉시 반영
  function applyRate() {
    syncRateUI();
    saveSettings();
    if (restartSidepanelChunk) restartSidepanelChunk();
  }

  function saveSettings() {
    chrome.runtime.sendMessage({
      type: 'SAVE_SETTINGS',
      settings: currentSettings
    });
  }

  function sendTabMessage(message, callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].id) {
        const tabId = tabs[0].id;
        chrome.tabs.sendMessage(tabId, message, (response) => {
          if (chrome.runtime.lastError) {
            console.warn('[SoriView-SidePanel] 탭 메시지 예외 발생, 콘텐츠 스크립트동적 주입 시도:', chrome.runtime.lastError.message);
            chrome.scripting.executeScript({
              target: { tabId: tabId, allFrames: false },
              files: [
                'content/parser.js',
                'content/tts_engine.js',
                'content/hover_speaker.js',
                'content/reader_overlay.js',
                'content/content_script.js'
              ]
            }).then(() => {
              setTimeout(() => {
                chrome.tabs.sendMessage(tabId, message, (retryResp) => {
                  if (callback) callback(retryResp || { success: true });
                });
              }, 250);
            }).catch((err) => {
              console.warn('[SoriView-SidePanel] 콘텐츠 스크립트 동적 주입 실패:', err);
              if (callback) callback({ success: false });
            });
          } else {
            if (callback) callback(response || { success: true });
          }
        }).catch(() => {
          if (callback) callback({ success: false });
        });
      } else {
        if (callback) callback({ success: false });
      }
    });
  }

  function setButtonLoading(buttonElement, originalText, loadingText) {
    buttonElement.disabled = true;
    buttonElement.classList.add('btn-loading');
    buttonElement.innerHTML = `<span class="spinner"></span> ${loadingText}`;

    setTimeout(() => {
      buttonElement.disabled = false;
      buttonElement.classList.remove('btn-loading');
      buttonElement.innerHTML = originalText;
    }, 1200);
  }

  /**
   * 텍스트 분할 & 전천후 정제 헬퍼 (v6)
   * - 줄바꿈(\n) 무작정 자르기 금지: 문단 및 문장을 최대 400자 덩어리로 병합
   * - URL, HTML 태그, 이모지, 웹 UI 기호 등 TTS 엔진 멈춤 유발 요소 자동 정제
   */
  function splitTextIntoSafeChunks(text, maxLen = 400) {
    if (!text || typeof text !== 'string') return [];

    // 1단계: 브라우저 TTS 엔진 멈춤을 유발하는 노이즈 요소 전천후 정제
    let cleaned = text
      .replace(/https?:\/\/[^\s]+/gi, ' [웹주소] ') // 길다란 URL 멈춤 방지
      .replace(/<[^>]*>/g, '') // HTML 태그 제거
      .replace(/(?:expand_more|more_horiz|expand_less)/gi, '') // 웹 UI 기호 제거
      .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '') // 특수 이모지 제거
      .replace(/[-=_]{3,}/g, '') // 구분선 연속 기호 제거
      .replace(/\r\n/g, '\n');

    // 2단계: 줄바꿈 단락 분리 및 문장 추출
    const rawParagraphs = cleaned.split(/\n+/);
    const sentences = [];

    for (let para of rawParagraphs) {
      para = para.trim();
      if (!para) continue;

      const parts = para.split(/(?<=[.!?。！？])\s*/);
      for (let part of parts) {
        const trimmed = part.trim();
        if (trimmed) sentences.push(trimmed);
      }
    }

    // 3단계: maxLen(400자) 이하의 문장들을 하나의 커다란 청크로 병합
    const chunks = [];
    let currentChunk = '';

    for (const sentence of sentences) {
      if (!currentChunk) {
        currentChunk = sentence;
      } else if ((currentChunk + ' ' + sentence).length <= maxLen) {
        currentChunk += ' ' + sentence;
      } else {
        chunks.push(currentChunk);
        currentChunk = sentence;
      }
    }
    if (currentChunk) chunks.push(currentChunk);

    return chunks.filter(Boolean);
  }

  let currentSpeechSessionId = 0;

  /**
   * 사이드바 고정 낭독 전용 파이프라인 (중복 낭독 원천 방지 단일 실행 가드 탑재)
   */
  function speakCustomTextInSidePanel(text) {
    // 이전 발화 세션 즉시 만료 및 완전 정지
    currentSpeechSessionId++;
    const thisSessionId = currentSpeechSessionId;

    sidepanelSpeaking = false;
    activeSidepanelUtterances.clear();
    stopSidepanelWatchdog();
    clearSidepanelSafetyTimeout();
    try { window.speechSynthesis.cancel(); } catch (e) {}

    const rawChunks = splitTextIntoSafeChunks(text, 400);
    if (rawChunks.length === 0) return;

    sidepanelSpeaking = true;
    setSpeakingUI(true); // 버튼 붉은색 시각 피드백 적용

    let currentIndex = 0;
    let isAdvancing = false; // 단일 문장 완료 시 중복 호출 방지 플래그

    // [스마트 폴링 왓치독] 100ms 주기 상태 감시 및 엔진 프리징 복구
    sidepanelWatchdogTimer = setInterval(() => {
      if (!sidepanelSpeaking || thisSessionId !== currentSpeechSessionId) {
        stopSidepanelWatchdog();
        setSpeakingUI(false);
        return;
      }

      if (window.speechSynthesis) {
        // 일시정지 상태 복구
        if (window.speechSynthesis.paused) {
          try { window.speechSynthesis.resume(); } catch (e) {}
        }

        // 혹시 onend가 유실되었더라도 발화가 끝났고 아직 다음 문장으로 넘어가지 않은 경우에만 단 1회 진행
        if (!window.speechSynthesis.speaking && !isAdvancing) {
          console.log(`[SoriView-Watchdog] 🔄 문장 ${currentIndex + 1}번 발화 완료 감지 -> 다음 문장 자동 진행`);
          advanceToNextChunk('watchdog');
        }
      }
    }, 100);

    // 속도 변경 시 현재 문장을 새 설정으로 다시 발화 (isAdvancing으로 cancel 콜백/왓치독의 다음 문장 진행 차단)
    // ponytail: 문장 처음부터 다시 읽음. 단어 위치 이어읽기가 필요하면 tts_engine의 시간 추정 방식 이식
    restartSidepanelChunk = () => {
      if (!sidepanelSpeaking || thisSessionId !== currentSpeechSessionId) return;
      isAdvancing = true;
      clearSidepanelSafetyTimeout();
      try { window.speechSynthesis.cancel(); } catch (e) {}
      setTimeout(() => {
        if (thisSessionId === currentSpeechSessionId && sidepanelSpeaking) {
          speakCurrentChunk();
        }
      }, 60);
    };

    // 다음 청크로의 전환을 단 1회만 보장하는 원자적 가드 함수
    function advanceToNextChunk(triggerSource) {
      if (isAdvancing) return; // 이미 다음 문장으로 전환 중이면 중복 실행 차단!
      if (!sidepanelSpeaking || thisSessionId !== currentSpeechSessionId) return;

      isAdvancing = true;
      clearSidepanelSafetyTimeout();

      currentIndex++;
      setTimeout(() => {
        if (thisSessionId === currentSpeechSessionId && sidepanelSpeaking) {
          speakCurrentChunk();
        }
      }, 60);
    }

    function speakCurrentChunk() {
      clearSidepanelSafetyTimeout();
      isAdvancing = false;

      if (!sidepanelSpeaking || thisSessionId !== currentSpeechSessionId || currentIndex >= rawChunks.length) {
        console.log('[SoriView-SidePanel] 🏁 커스텀 텍스트 1회 전체 연속 낭독 완료!');
        sidepanelSpeaking = false;
        setSpeakingUI(false);
        activeSidepanelUtterances.clear();
        stopSidepanelWatchdog();
        return;
      }

      const sentenceText = rawChunks[currentIndex];
      console.log(`[SoriView-SidePanel] 🔊 [문장 ${currentIndex + 1}/${rawChunks.length}]: "${sentenceText.substring(0, 30)}..."`);

      const utt = new SpeechSynthesisUtterance(sentenceText);
      activeSidepanelUtterances.add(utt);

      const currentRate = currentSettings.rate || 1.0;
      utt.rate = currentRate;
      utt.pitch = currentSettings.pitch || 1.0;
      utt.volume = currentSettings.volume !== undefined ? currentSettings.volume : 1.0;

      const voices = window.speechSynthesis.getVoices();
      if (currentSettings.voiceName) {
        const found = voices.find(v => v.name === currentSettings.voiceName || v.name.includes(currentSettings.voiceName));
        if (found) utt.voice = found;
      }

      // 안전 타임아웃
      const calculateTimeout = () => Math.max(45000, Math.ceil((sentenceText.length * 800) / currentRate) + 25000);
      sidepanelSafetyTimeoutTimer = setTimeout(() => {
        if (!sidepanelSpeaking || thisSessionId !== currentSpeechSessionId) return;
        if (window.speechSynthesis && window.speechSynthesis.speaking) {
          try { window.speechSynthesis.resume(); } catch (e) {}
          return;
        }
        advanceToNextChunk('safetyTimeout');
      }, calculateTimeout());

      utt.onstart = () => {
        if (!sidepanelSpeaking || thisSessionId !== currentSpeechSessionId) return;
      };

      utt.onend = () => {
        clearSidepanelSafetyTimeout();
        activeSidepanelUtterances.delete(utt);
        if (!sidepanelSpeaking || thisSessionId !== currentSpeechSessionId) return;
        advanceToNextChunk('onend');
      };

      utt.onerror = (e) => {
        clearSidepanelSafetyTimeout();
        activeSidepanelUtterances.delete(utt);
        if (!sidepanelSpeaking || thisSessionId !== currentSpeechSessionId) return;
        if (e.error === 'interrupted' || e.error === 'canceled') return;
        console.warn('[SoriView-SidePanel] 발화 에러:', e);
        advanceToNextChunk('onerror');
      };

      try {
        window.speechSynthesis.speak(utt);
      } catch (e) {
        console.error('[SoriView-SidePanel] speak 호출 실패:', e);
        advanceToNextChunk('speakCatch');
      }
    }

    // 첫 번째 문장 발화 시작
    speakCurrentChunk();
  }

  function stopAllReading() {
    sidepanelSpeaking = false;
    setSpeakingUI(false);
    activeSidepanelUtterances.clear();
    stopSidepanelWatchdog();
    clearSidepanelSafetyTimeout();
    try { window.speechSynthesis.cancel(); } catch (e) {}
    chrome.runtime.sendMessage({ type: 'STOP_READING' }).catch(() => {});
    sendTabMessage({ type: 'STOP_READING' });
  }

  // 백그라운드 및 컨텐츠 스크립트 정지 신호 동시 수신
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'STOP_READING') {
      sidepanelSpeaking = false;
      setSpeakingUI(false);
      activeSidepanelUtterances.clear();
      stopSidepanelWatchdog();
      clearSidepanelSafetyTimeout();
      try { window.speechSynthesis.cancel(); } catch (e) {}
      console.log('[SoriView-SidePanel] 🛑 정지 신호 수신으로 사이드바 낭독 100% 완전 정지 완료.');
    }
  });

  // 이벤트 리스너 설정
  btnReadPage.addEventListener('click', () => {
    stopAllReading();
    setButtonLoading(btnReadPage, '📖 전체 본문 연속 낭독', '⏳ 음성 변환 중...');
    sendTabMessage({ type: 'READ_FULL_PAGE' });
  });

  btnToggleReader.addEventListener('click', () => {
    sendTabMessage({ type: 'TOGGLE_READER_VIEW' });
  });

  btnStopReading.addEventListener('click', () => {
    stopAllReading();
  });

  if (btnPasteRead) {
    btnPasteRead.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (!text || !text.trim()) {
          alert('클립보드에 복사된 텍스트가 없습니다. Ctrl+C로 복사한 후 다시 클릭해 주세요!');
          return;
        }
        txtCustomInput.value = text.trim();
        if (sidepanelSpeaking) {
          stopAllReading();
          return;
        }
        stopAllReading();
        setButtonLoading(btnReadCustom, '▶️ 즉시 낭독 시작', '⏳ 준비 중...');
        setTimeout(() => {
          speakCustomTextInSidePanel(text.trim());
        }, 100);
      } catch (err) {
        alert('클립보드 권한이 필요합니다. 입력창에 Ctrl+V로 붙여넣은 후 [▶️ 즉시 낭독 시작]을 클릭해 주세요!');
      }
    });
  }

  btnReadCustom.addEventListener('click', () => {
    // 낭독 중일 때 클릭하면 낭독 정지
    if (sidepanelSpeaking) {
      stopAllReading();
      return;
    }

    const text = txtCustomInput.value.trim();
    if (!text) {
      alert('낭독할 텍스트를 입력하거나 붙여넣어 주세요!');
      return;
    }

    stopAllReading();
    setButtonLoading(btnReadCustom, '▶️ 즉시 낭독 시작', '⏳ 준비 중...');
    setTimeout(() => {
      speakCustomTextInSidePanel(text);
    }, 100);
  });

  selectVoice.addEventListener('change', (e) => {
    currentSettings.voiceName = e.target.value;
    console.log('[SoriView-SidePanel] 음성 지정 변경:', currentSettings.voiceName);
    saveSettings();
  });

  chkHoverSpeak.addEventListener('change', (e) => {
    currentSettings.hoverSpeak = e.target.checked;
    saveSettings();
  });

  if (sliderVolume) {
    sliderVolume.addEventListener('input', (e) => {
      currentSettings.volume = parseFloat(e.target.value);
      valVolume.innerText = `${Math.round(currentSettings.volume * 100)}%`;
      saveSettings();
    });
  }

  // 드래그 중에는 표시만 갱신, 손을 뗀 순간(change) 1회만 저장·재시작 (드래그마다 재시작하면 더듬거림)
  sliderRate.addEventListener('input', (e) => {
    currentSettings.rate = parseFloat(e.target.value);
    syncRateUI();
  });
  sliderRate.addEventListener('change', applyRate);

  document.querySelectorAll('.rate-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      currentSettings.rate = parseFloat(btn.dataset.rate);
      sliderRate.value = currentSettings.rate;
      applyRate();
    });
  });

  sliderPitch.addEventListener('input', (e) => {
    currentSettings.pitch = parseFloat(e.target.value);
    valPitch.innerText = `${currentSettings.pitch}`;
    saveSettings();
  });
});
