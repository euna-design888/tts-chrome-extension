/**
 * background.js - Chrome Extension Service Worker (Manifest V3)
 * 백그라운드에서 확장 프로그램의 상태, 메시지 브릿지, 기본 설정을 관리합니다.
 */

// 기본 설정 값 정의 ('Google 한국어'를 글로벌 1순위 기본 음성으로 설정)
const DEFAULT_SETTINGS = {
  rate: 1.0,         // 읽기 속도 (0.5 ~ 2.0)
  pitch: 1.0,        // 음높이 (0.5 ~ 1.5)
  volume: 1.0,       // 음량 (0.0 ~ 1.0)
  lang: 'ko-KR',     // 기본 언어
  voiceName: 'Google 한국어', // 최우선 기본 고정 음성
  hoverSpeak: true,  // Shift + 마우스 낭독 활성화 여부
  theme: 'high-contrast-dark', // 기본 테마: 고대비 다크
  fontSize: 24,      // 리더 뷰 기본 폰트 크기 (px)
  letterSpacing: 2   // 리더 뷰 기본 자간 (px)
};

// 확장 프로그램 최초 설치/업데이트 시 기본 설정 초기화 & 툴바 아이콘 클릭 시 오른쪽 사이드바 열림 설정
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['ttsSettings'], (result) => {
    if (!result.ttsSettings) {
      chrome.storage.local.set({ ttsSettings: DEFAULT_SETTINGS }, () => {
        console.log('[SoriView-Background] 기본 음성이 [Google 한국어]로 초기화되었습니다.', DEFAULT_SETTINGS);
      });
    }
  });

  // 툴바 아이콘 클릭 시 사이드바(Side Panel) 바로 오픈 설정
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => {
      console.warn('[SoriView-Background] SidePanel 동작 설정 실패:', err);
    });
  }
});

// 백그라운드 구동 시 SidePanel 오픈 동작 보장
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

// Content Script 및 Popup 간 브릿지 메시지 라우팅
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'GET_SETTINGS':
      chrome.storage.local.get(['ttsSettings'], (result) => {
        sendResponse({ settings: result.ttsSettings || DEFAULT_SETTINGS });
      });
      return true; // 비동기 응답 처리

    case 'SAVE_SETTINGS':
      chrome.storage.local.set({ ttsSettings: message.settings }, () => {
        // 활성화된 탭의 Content Script로 변경된 설정 브로드캐스팅
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0] && tabs[0].id) {
            chrome.tabs.sendMessage(tabs[0].id, {
              type: 'SETTINGS_UPDATED',
              settings: message.settings
            }).catch(() => {
              // 콘텐츠 스크립트가 아직 주입되지 않은 탭 처리 예외 방지
            });
          }
        });
        sendResponse({ success: true });
      });
      return true;

    case 'STOP_READING':
      // 모든 활성 탭 및 프레임으로 낭독 정지 명령 360도 브로드캐스팅
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, { type: 'STOP_READING' }).catch(() => {});
          }
        });
      });
      sendResponse({ success: true });
      return true;

    default:
      return false;
  }
});

// 확장 프로그램 아이콘 클릭 시 오른쪽 사이드패널 즉시 오픈 (Fallback 보장)
if (chrome.action && chrome.action.onClicked) {
  chrome.action.onClicked.addListener((tab) => {
    if (chrome.sidePanel && chrome.sidePanel.open) {
      chrome.sidePanel.open({ windowId: tab.windowId }).catch((err) => {
        console.warn('[SoriView-Background] SidePanel 열기 실패:', err);
      });
    }
  });
}

// 크롬 단축키 (Chrome Global Commands) 이벤트 수신기
chrome.commands.onCommand.addListener((command) => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0] && tabs[0].id) {
      if (command === 'stop-reading') {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'STOP_READING' }).catch(() => {});
      } else if (command === 'toggle-read-page') {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'READ_FULL_PAGE' }).catch(() => {});
      }
    }
  });
});

