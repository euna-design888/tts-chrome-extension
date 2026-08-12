/**
 * content/tts_engine.js - 소리뷰 스마트 하이브리드 TTS 엔진
 * 
 * [혁신적 하이브리드 낭독 엔진 설계]
 * 1. 평소 낭독: 자연스러운 전체 문장을 단어 끊김 없이 100% 부드럽고 생생한 음성으로 연결 낭독.
 * 2. 일시정지 (Ctrl+Space): 멈춘 순간의 단어 위치(Word Boundary/시간 추적)를 감지하여 남은 텍스트 슬라이싱.
 * 3. 이어서 낭독 (Ctrl+Space): "위해"에서 멈추면 "백화점을 갔습니다"부터 자연스럽게 이어서 재생!
 * 4. 결과: 자연스러운 음성 품질 100% + 단어 단위 정밀 이어서 읽기 100% 동시 완수!
 */

window.TTSEngine = class TTSEngine {
  constructor() {
    this.synth = window.speechSynthesis;
    this.currentUtterance = null;
    this.isPlaying = false;
    this.isPaused = false;
    this.queue = [];
    this.currentIndex = 0;
    
    // 스마트 단어 이어서 읽기용 메모리
    this.savedPausedIndex = 0;
    this.savedResumeText = null;
    this.segmentStartTime = 0;
    this.lastBoundaryCharIndex = 0;
    this.currentTextBeingSpoken = '';

    this.settings = {
      rate: 1.0,
      pitch: 1.0,
      volume: 1.0,
      lang: 'ko-KR',
      voiceName: 'Google 한국어'
    };

    this.onBoundaryCallback = null;
    this.onSegmentChangeCallback = null;
    this.onEndCallback = null;

    this.activeUtterances = new Set();
    this.selectedVoice = null;
    this.keepAliveTimer = null;
    this.safetyTimeoutTimer = null;
    this.initVoices();
  }

  initVoices() {
    const updateVoices = () => {
      const voices = this.synth.getVoices();
      if (!voices || voices.length === 0) return;

      if (this.settings.voiceName) {
        const found = voices.find(v =>
          v.name === this.settings.voiceName || v.name.includes(this.settings.voiceName)
        );
        if (found) { this.selectedVoice = found; return; }
      }

      const googleKorean = voices.find(v =>
        v.name.includes('Google') && (v.lang.includes('ko') || v.lang.includes('KO'))
      );
      if (googleKorean) { this.selectedVoice = googleKorean; return; }

      const koreanVoices = voices.filter(v => v.lang.includes('ko') || v.lang.includes('KO'));
      this.selectedVoice =
        koreanVoices.find(v => v.name.includes('Natural') || v.name.includes('Neural') || v.name.includes('Online')) ||
        koreanVoices[0] ||
        voices[0];
    };

    updateVoices();
    if (speechSynthesis.onvoiceschanged !== undefined) {
      speechSynthesis.onvoiceschanged = updateVoices;
    }
  }

  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    if (this.synth && newSettings.voiceName) {
      const found = this.synth.getVoices().find(v =>
        v.name === newSettings.voiceName || v.name.includes(newSettings.voiceName)
      );
      if (found) this.selectedVoice = found;
    }
  }

  getNormalizedVolume(voice, userVolume) {
    let vol = userVolume !== undefined ? userVolume : 1.0;
    if (vol <= 0) return 0;
    const name = voice ? voice.name : '';
    let mult = 1.0;
    if (name.includes('Google')) mult = 0.85;
    else if (name.includes('Desktop') || name.includes('Local')) mult = 0.90;
    return Math.min(1.0, Math.max(0.05, vol * mult));
  }

  speakSegments(segments, startIndex = 0) {
    this.isPlaying = false;
    this.isPaused = false;
    if (this.activeUtterances) this.activeUtterances.clear();
    try { this.synth.cancel(); } catch (e) {}
    this.currentUtterance = null;

    this.queue = segments || [];
    this.currentIndex = startIndex;
    this.savedPausedIndex = startIndex;
    this.savedResumeText = null;
    this.isPlaying = true;

    console.log(`[SoriView] 🚀 스마트 하이브리드 낭독 시작 (총 ${this.queue.length}개 문장)`);
    setTimeout(() => { this.speakCurrentSegment(); }, 80);
  }

  findNearestWordBoundary(text, targetCharIndex) {
    if (!text || targetCharIndex <= 0) return 0;
    if (targetCharIndex >= text.length) return text.length;

    let pos = text.indexOf(' ', targetCharIndex);
    if (pos !== -1 && pos - targetCharIndex < 8) {
      return pos + 1;
    }
    let lastPos = text.lastIndexOf(' ', targetCharIndex);
    if (lastPos !== -1) {
      return lastPos + 1;
    }
    return targetCharIndex;
  }

  splitTextIntoSafeChunks(text, maxLen = 120) {
    if (!text || typeof text !== 'string') return [];

    // 1차: 줄바꿈(\r\n, \n) 및 마침표/기호 기준 분할
    const lines = text.split(/[\r\n]+/);
    const rawChunks = [];

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      const sentences = trimmedLine.split(/(?<=[.!?\n])\s+|(?<=[.!?\n])$/);
      for (let s of sentences) {
        s = s.trim();
        if (s) rawChunks.push(s);
      }
    }

    const chunks = [];
    for (let sentence of rawChunks) {
      if (sentence.length <= maxLen) {
        chunks.push(sentence);
      } else {
        const subParts = sentence.split(/(?<=[,;:~()\[\]"'""''“”])\s+/);
        let currentChunk = '';

        for (let part of subParts) {
          part = part.trim();
          if (!part) continue;

          if ((currentChunk + ' ' + part).trim().length <= maxLen) {
            currentChunk = (currentChunk + ' ' + part).trim();
          } else {
            if (currentChunk) chunks.push(currentChunk);

            if (part.length <= maxLen) {
              currentChunk = part;
            } else {
              const words = part.split(/\s+/);
              currentChunk = '';
              for (let word of words) {
                if ((currentChunk + ' ' + word).trim().length <= maxLen) {
                  currentChunk = (currentChunk + ' ' + word).trim();
                } else {
                  if (currentChunk) chunks.push(currentChunk);
                  if (word.length > maxLen) {
                    for (let i = 0; i < word.length; i += maxLen) {
                      chunks.push(word.slice(i, i + maxLen));
                    }
                    currentChunk = '';
                  } else {
                    currentChunk = word;
                  }
                }
              }
            }
          }
        }
        if (currentChunk) chunks.push(currentChunk);
      }
    }
    return chunks;
  }

  clearSafetyTimeout() {
    if (this.safetyTimeoutTimer) {
      clearTimeout(this.safetyTimeoutTimer);
      this.safetyTimeoutTimer = null;
    }
  }

  startKeepAliveTimer() {
    this.clearKeepAliveTimer();
    this.keepAliveTimer = setInterval(() => {
      if (!this.isPlaying || this.isPaused || !this.synth) return;
      if (this.synth.speaking && !this.synth.paused) {
        try {
          this.synth.pause();
          this.synth.resume();
        } catch (e) {}
      }
    }, 10000); // Chrome Web Speech API 15초 자동 멈춤 버그 방지 (10초 주기 하트비트)
  }

  clearKeepAliveTimer() {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  speakCurrentSegment(overrideText = null) {
    this.clearSafetyTimeout();

    if (!this.isPlaying || this.isPaused || this.queue.length === 0) {
      this.clearKeepAliveTimer();
      return;
    }

    if (this.currentIndex >= this.queue.length) {
      console.log('[SoriView] 🏁 전체 텍스트 낭독 완수!');
      this.stop();
      if (this.onEndCallback) this.onEndCallback();
      return;
    }

    // Chrome TTS 엔진 잠김 방지 및 하트비트 활성화
    try {
      if (this.synth && this.synth.paused) {
        this.synth.resume();
      }
    } catch(e) {}
    this.startKeepAliveTimer();

    const currentItem = this.queue[this.currentIndex];
    if (!currentItem || !currentItem.text) {
      this.currentIndex++;
      this.savedResumeText = null;
      this.speakCurrentSegment();
      return;
    }

    const textToSpeak = overrideText || currentItem.text;
    this.currentTextBeingSpoken = textToSpeak;
    this.segmentStartTime = Date.now();
    this.lastBoundaryCharIndex = 0;

    console.log(`[SoriView] 🔊 [문장 ${this.currentIndex + 1}/${this.queue.length}]: "${textToSpeak.substring(0, 35)}..."`);

    if (this.onSegmentChangeCallback) {
      this.onSegmentChangeCallback(currentItem, this.currentIndex);
    }

    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    if (this.activeUtterances) this.activeUtterances.add(utterance);

    const currentRate = this.settings.rate || 1.0;
    utterance.rate = currentRate;
    utterance.pitch = this.settings.pitch;
    utterance.volume = this.getNormalizedVolume(this.selectedVoice, this.settings.volume);

    if (this.selectedVoice) {
      utterance.voice = this.selectedVoice;
      utterance.lang = this.selectedVoice.lang || this.settings.lang;
    } else {
      utterance.lang = this.settings.lang;
    }

    // 안전 타임아웃 설정: 억지 끊김 방지를 위해 넉넉한 여유 시간(최소 35초 ~ 글자수 비례) 부여
    const calculateTimeout = () => Math.max(35000, Math.ceil((textToSpeak.length * 800) / currentRate) + 20000);
    
    const scheduleSafetyTimeout = () => {
      this.clearSafetyTimeout();
      this.safetyTimeoutTimer = setTimeout(() => {
        if (!this.isPlaying || this.isPaused) return;

        // 실제 브라우저가 음성을 말하고 있는 중이라면(Google 한국어 등 onboundary 미지원 음성 포함) cancel하지 않고 타임아웃 연장
        if (this.synth && this.synth.speaking) {
          try { this.synth.resume(); } catch (e) {}
          scheduleSafetyTimeout();
          return;
        }

        console.warn(`[SoriView] ⚠️ 문장 ${this.currentIndex + 1}번 낭독 멈춤 감지 -> 다음 세그먼트로 자동 연결`);
        if (this.activeUtterances) this.activeUtterances.delete(utterance);
        try { this.synth.cancel(); } catch (e) {}
        this.savedResumeText = null;
        this.currentIndex++;
        this.savedPausedIndex = this.currentIndex;
        this.speakCurrentSegment();
      }, calculateTimeout());
    };

    scheduleSafetyTimeout();

    utterance.onstart = () => {
      if (!this.isPlaying || this.isPaused) return;
      scheduleSafetyTimeout();
    };

    utterance.onboundary = (event) => {
      if (!this.isPlaying || this.isPaused) return;
      this.lastBoundaryCharIndex = event.charIndex || 0;

      // 단어 경계 감지 시 타임아웃 연장
      scheduleSafetyTimeout();

      if (this.onBoundaryCallback) {
        this.onBoundaryCallback({ charIndex: event.charIndex, charLength: event.charLength || 1, currentItem });
      }
    };

    utterance.onend = () => {
      this.clearSafetyTimeout();
      if (this.activeUtterances) this.activeUtterances.delete(utterance);
      if (this.isPaused || !this.isPlaying) return;
      this.savedResumeText = null;
      this.currentIndex++;
      this.savedPausedIndex = this.currentIndex;
      this.speakCurrentSegment();
    };

    utterance.onerror = (err) => {
      this.clearSafetyTimeout();
      if (this.activeUtterances) this.activeUtterances.delete(utterance);
      if (this.isPaused || !this.isPlaying) return;
      if (err.error === 'interrupted' || err.error === 'canceled') return;
      console.warn('[TTS-Engine] 발화 에러:', err);
      this.savedResumeText = null;
      this.currentIndex++;
      this.savedPausedIndex = this.currentIndex;
      this.speakCurrentSegment();
    };

    this.currentUtterance = utterance;
    try { this.synth.speak(utterance); } catch (e) {}
  }

  speakSingleText(text, targetElement = null) {
    if (!text || typeof text !== 'string') return;
    const cleanText = text.trim();
    if (!cleanText) return;

    const safeChunks = this.splitTextIntoSafeChunks(cleanText, 120);
    const segments = safeChunks.map(s => ({
      element: targetElement,
      text: s
    }));

    this.speakSegments(segments, 0);
  }

  /**
   * 스마트 일시정지 - 이어서 읽기 토글 (단어 단위 슬라이싱 재개)
   */
  togglePauseResume() {
    // 1) 낭독 중 ➔ 일시정지 (멈춘 단어 위치 추적 및 남은 텍스트 계산)
    if (this.isPlaying && !this.isPaused) {
      this.savedPausedIndex = this.currentIndex;
      const fullText = this.currentTextBeingSpoken || (this.queue[this.currentIndex] ? this.queue[this.currentIndex].text : '');

      let charPos = 0;
      if (this.lastBoundaryCharIndex > 0) {
        charPos = this.lastBoundaryCharIndex;
      } else {
        // onboundary가 발화되지 않는 구글 한국어 엔진 대응 시간 기반 추정
        const elapsedSec = (Date.now() - this.segmentStartTime) / 1000;
        const estimatedChars = Math.floor(elapsedSec * 11.5 * (this.settings.rate || 1.0));
        charPos = this.findNearestWordBoundary(fullText, estimatedChars);
      }

      const remainingText = fullText.substring(charPos).trim();
      this.savedResumeText = (remainingText.length >= 2) ? remainingText : null;

      this.isPaused = true;
      this.isPlaying = false;
      this.clearSafetyTimeout();
      this.clearKeepAliveTimer();
      try { this.synth.cancel(); } catch (e) {}

      console.log(`[SoriView] ⏸️ 일시정지 완료 (문장 ${this.savedPausedIndex}번, 남은 텍스트: "${this.savedResumeText}")`);
      return 'PAUSED';
    }

    // 2) 일시정지 ➔ 멈춘 그 단어 위치부터 100% 자연스럽게 이어서 낭독!
    if (this.isPaused) {
      this.currentIndex = this.savedPausedIndex;
      this.isPaused = false;
      this.isPlaying = true;

      const resumeText = this.savedResumeText;
      console.log(`[SoriView] ▶️ 이어서 낭독 시작 (문장 ${this.currentIndex}번, 재생 텍스트: "${resumeText || '전체'}")`);

      setTimeout(() => {
        if (resumeText) {
          this.speakCurrentSegment(resumeText);
        } else {
          this.speakCurrentSegment();
        }
      }, 80);
      return 'RESUMED';
    }

    // 3) 대기 큐가 남아있는 경우 재개
    if (!this.isPlaying && this.queue.length > 0 && this.currentIndex < this.queue.length) {
      this.isPaused = false;
      this.isPlaying = true;
      console.log(`[SoriView] ▶️ 대기 큐 ${this.currentIndex}번부터 재개`);
      setTimeout(() => { this.speakCurrentSegment(); }, 80);
      return 'RESUMED';
    }

    return 'NONE';
  }

  pause() { this.togglePauseResume(); }

  resume() {
    if (this.isPaused || this.queue.length > 0) this.togglePauseResume();
  }

  stop() {
    this.isPlaying = false;
    this.isPaused = false;
    this.clearSafetyTimeout();
    this.clearKeepAliveTimer();
    if (this.activeUtterances) this.activeUtterances.clear();
    try { this.synth.cancel(); } catch (e) {}
    this.currentUtterance = null;
    this.queue = [];
    this.currentIndex = 0;
    this.savedPausedIndex = 0;
    this.savedResumeText = null;
    console.log('[SoriView] ⏹️ 낭독 100% 완전 정지');
  }

  next() {
    if (this.currentIndex < this.queue.length - 1) {
      try { this.synth.cancel(); } catch(e) {}
      this.currentIndex++;
      this.savedPausedIndex = this.currentIndex;
      this.savedResumeText = null;
      setTimeout(() => { this.speakCurrentSegment(); }, 50);
    } else {
      this.stop();
    }
  }

  previous() {
    try { this.synth.cancel(); } catch(e) {}
    if (this.currentIndex > 0) this.currentIndex--;
    this.savedPausedIndex = this.currentIndex;
    this.savedResumeText = null;
    setTimeout(() => { this.speakCurrentSegment(); }, 50);
  }
};
