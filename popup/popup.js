/**
 * popup.js - 소리뷰(SoriView) 팝업 컨트롤러 UI 로직
 * 오직 [한국어 1순위 + 영어 2순위] 최고 품질 자연스러운 AI 음성 5개만 엄선 고정
 */

document.addEventListener('DOMContentLoaded', () => {
  const btnReadPage = document.getElementById('btn-read-page');
  const btnToggleReader = document.getElementById('btn-toggle-reader');
  const btnStopReading = document.getElementById('btn-stop-reading');
  const btnReadCustom = document.getElementById('btn-read-custom');
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

  // 1. 한국어(1순위) & 영어(2순위) 최고 품질 자연스러운 AI 음성 TOP 5 엄선
  function loadTop5VoiceList() {
    const voices = speechSynthesis.getVoices();
    if (!voices || voices.length === 0) return;

    selectVoice.innerHTML = '';

    const top5Voices = [];

    // [1] Google 한국어 (글로벌 1순위 기본 고정)
    const googleKorean = voices.find(v => (v.lang.includes('ko') || v.lang.includes('KO')) && v.name.includes('Google'));
    if (googleKorean) {
      top5Voices.push({ voice: googleKorean, label: '🌟 [고품질 AI] Google 한국어 (기본 지정)' });
    }

    // [2] 한국어 자연스러운 여성 AI 성우 (Sun-Hi 또는 대표 여성 음성)
    const sunHiKorean = voices.find(v => (v.lang.includes('ko') || v.lang.includes('KO')) && (v.name.includes('Sun-Hi') || v.name.includes('SunHi') || v.name.includes('Natural')));
    if (sunHiKorean && !top5Voices.some(i => i.voice.name === sunHiKorean.name)) {
      top5Voices.push({ voice: sunHiKorean, label: '✨ [AI 여성 성우] Sun-Hi (자연스러운 한국어)' });
    }

    // [3] 한국어 단아한 여성 AI 성우 (Heami 또는 기타 한국어 여성)
    const heamiKorean = voices.find(v => (v.lang.includes('ko') || v.lang.includes('KO')) && v.name.includes('Heami'));
    if (heamiKorean && !top5Voices.some(i => i.voice.name === heamiKorean.name)) {
      top5Voices.push({ voice: heamiKorean, label: '👩 [AI 여성 성우] Heami (한국어 여성)' });
    }

    // [4] 한국어 신뢰감 있는 남성 AI 성우 (InJoon / BongJin 또는 기타 한국어 남성)
    const maleKorean = voices.find(v => (v.lang.includes('ko') || v.lang.includes('KO')) && (v.name.includes('InJoon') || v.name.includes('BongJin') || v.name.toLowerCase().includes('male')));
    if (maleKorean && !top5Voices.some(i => i.voice.name === maleKorean.name)) {
      top5Voices.push({ voice: maleKorean, label: '👨 [AI 남성 성우] InJoon (한국어 남성)' });
    }

    // [5] 2순위: 최고 품질 자연스러운 미국식 영어 AI 성우 (Google US English / Jenny / Natural English)
    const englishVoice = voices.find(v => (v.lang.includes('en') || v.lang.includes('EN')) && (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Jenny') || v.name.includes('US')));
    if (englishVoice && !top5Voices.some(i => i.voice.name === englishVoice.name)) {
      top5Voices.push({ voice: englishVoice, label: '🌐 [AI 영어 성우] Natural US English (미국식 영어)' });
    }

    // 5개 미만 시 한국어/영어 음성으로 안전하게 채우기
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
      
      if (currentSettings.voiceName === item.voice.name || (currentSettings.voiceName.includes('Google') && item.voice.name.includes('Google') && item.voice.lang.includes('ko'))) {
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
  if (speechSynthesis.onvoiceschanged !== undefined) {
    speechSynthesis.onvoiceschanged = loadTop5VoiceList;
  }

  // 2. 기존 저장 설정 로드
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
    
    valRate.innerText = `${currentSettings.rate}x`;
    valPitch.innerText = `${currentSettings.pitch}`;
    if (valVolume) valVolume.innerText = `${Math.round((currentSettings.volume !== undefined ? currentSettings.volume : 1.0) * 100)}%`;
    
    chkHoverSpeak.checked = currentSettings.hoverSpeak;
    
    if (currentSettings.voiceName && selectVoice.options.length > 0) {
      selectVoice.value = currentSettings.voiceName;
    }
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
        chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
          if (chrome.runtime.lastError) {
            console.warn('[TTS-Popup] 메시지 전달 예외:', chrome.runtime.lastError.message);
            if (callback) callback({ success: false });
          } else {
            if (callback) callback(response || { success: true });
          }
        }).catch((err) => {
          console.warn('[TTS-Popup] 메시지 전달 예외:', err);
          if (callback) callback({ success: false });
        });
      } else {
        if (callback) callback({ success: false });
      }
    });
  }

  let activePopupUtterances = new Set();

  function splitTextIntoSafeChunks(text, maxLen = 400) {
    if (!text || typeof text !== 'string') return [];

    let cleaned = text
      .replace(/https?:\/\/[^\s]+/gi, ' [웹주소] ')
      .replace(/<[^>]*>/g, '')
      .replace(/(?:expand_more|more_horiz|expand_less)/gi, '')
      .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
      .replace(/[-=_]{3,}/g, '')
      .replace(/\r\n/g, '\n');

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

  let popupSafetyTimeoutTimer = null;
  function clearPopupSafetyTimeout() {
    if (popupSafetyTimeoutTimer) {
      clearTimeout(popupSafetyTimeoutTimer);
      popupSafetyTimeoutTimer = null;
    }
  }

  let popupWatchdogTimer = null;
  function stopPopupWatchdog() {
    if (popupWatchdogTimer) {
      clearInterval(popupWatchdogTimer);
      popupWatchdogTimer = null;
    }
  }

  function speakFallbackInPopup(text) {
    if (!('speechSynthesis' in window)) return;
    activePopupUtterances.clear();
    stopPopupWatchdog();
    clearPopupSafetyTimeout();
    try { window.speechSynthesis.cancel(); } catch (e) {}

    const rawChunks = splitTextIntoSafeChunks(text, 150);
    if (rawChunks.length === 0) return;

    let popupSpeaking = true;
    let index = 0;
    let isChunkSpeaking = false;

    popupWatchdogTimer = setInterval(() => {
      if (!popupSpeaking) {
        stopPopupWatchdog();
        return;
      }

      if (window.speechSynthesis) {
        if (window.speechSynthesis.paused) {
          try { window.speechSynthesis.resume(); } catch (e) {}
        }

        if (isChunkSpeaking && !window.speechSynthesis.speaking) {
          isChunkSpeaking = false;
          index++;
          setTimeout(() => {
            speakNext();
          }, 80);
        }
      }
    }, 100);

    function speakNext() {
      clearPopupSafetyTimeout();

      if (!popupSpeaking || index >= rawChunks.length) {
        popupSpeaking = false;
        activePopupUtterances.clear();
        stopPopupWatchdog();
        return;
      }

      const sentenceText = rawChunks[index];
      const utt = new SpeechSynthesisUtterance(sentenceText);
      activePopupUtterances.add(utt);

      const currentRate = currentSettings.rate || 1.0;
      utt.rate = currentRate;
      utt.pitch = currentSettings.pitch || 1.0;
      utt.volume = currentSettings.volume !== undefined ? currentSettings.volume : 1.0;

      const voices = window.speechSynthesis.getVoices();
      if (currentSettings.voiceName) {
        const found = voices.find(v => v.name === currentSettings.voiceName || v.name.includes(currentSettings.voiceName));
        if (found) utt.voice = found;
      }

      const calculateTimeout = () => Math.max(45000, Math.ceil((sentenceText.length * 800) / currentRate) + 25000);
      popupSafetyTimeoutTimer = setTimeout(() => {
        if (!popupSpeaking) return;
        if (window.speechSynthesis && window.speechSynthesis.speaking) {
          try { window.speechSynthesis.resume(); } catch (e) {}
          return;
        }
        isChunkSpeaking = false;
        index++;
        setTimeout(() => { speakNext(); }, 80);
      }, calculateTimeout());

      utt.onstart = () => {
        if (!popupSpeaking) return;
        isChunkSpeaking = true;
      };

      utt.onend = () => {
        clearPopupSafetyTimeout();
        if (!popupSpeaking) return;
        if (isChunkSpeaking) {
          isChunkSpeaking = false;
          index++;
          setTimeout(() => { speakNext(); }, 80);
        }
      };
      utt.onerror = (e) => {
        clearPopupSafetyTimeout();
        if (!popupSpeaking) return;
        if (e.error === 'interrupted' || e.error === 'canceled') return;
        isChunkSpeaking = false;
        index++;
        setTimeout(() => { speakNext(); }, 80);
      };

      isChunkSpeaking = true;
      try { window.speechSynthesis.speak(utt); } catch (e) {}
    }

    speakNext();
  }

  function setButtonLoading(buttonElement, originalText, loadingText) {
    buttonElement.disabled = true;
    buttonElement.classList.add('btn-loading');
    buttonElement.innerHTML = `<span class="spinner"></span> ${loadingText}`;

    setTimeout(() => {
      buttonElement.disabled = false;
      buttonElement.classList.remove('btn-loading');
      buttonElement.innerHTML = originalText;
    }, 1800);
  }

  // 3. 이벤트 리스너 설정
  btnReadPage.addEventListener('click', () => {
    setButtonLoading(btnReadPage, '📖 전체 본문 연속 낭독', '⏳ 음성 변환 중...');
    sendTabMessage({ type: 'READ_FULL_PAGE' });
  });

  btnToggleReader.addEventListener('click', () => {
    sendTabMessage({ type: 'TOGGLE_READER_VIEW' });
  });

  btnStopReading.addEventListener('click', () => {
    window.speechSynthesis.cancel();
    sendTabMessage({ type: 'STOP_READING' });
  });

  btnReadCustom.addEventListener('click', () => {
    const text = txtCustomInput.value.trim();
    if (!text) {
      alert('낭독할 텍스트를 입력하거나 붙여넣어 주세요!');
      return;
    }

    setButtonLoading(btnReadCustom, '▶️ 입력 텍스트 즉시 낭독', '⏳ 음성 변환 중...');
    sendTabMessage({ type: 'READ_CUSTOM_TEXT', text }, (response) => {
      if (!response || !response.success) {
        // 특수 페이지(chrome://) 등 Content Script 미주입 시 팝업 직접 Fallback 낭독
        speakFallbackInPopup(text);
      }
    });
  });

  // 🎙️ 음성 선택 시 즉시 기본값(Default)으로 저장
  selectVoice.addEventListener('change', (e) => {
    currentSettings.voiceName = e.target.value;
    console.log('[SoriView] 한국어/영어 정예 AI 음성 지정:', currentSettings.voiceName);
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

  sliderRate.addEventListener('input', (e) => {
    currentSettings.rate = parseFloat(e.target.value);
    valRate.innerText = `${currentSettings.rate}x`;
    saveSettings();
  });

  sliderPitch.addEventListener('input', (e) => {
    currentSettings.pitch = parseFloat(e.target.value);
    valPitch.innerText = `${currentSettings.pitch}`;
    saveSettings();
  });
});
