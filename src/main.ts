import { Capacitor } from '@capacitor/core';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import './styles/editor.css';
import { EditorApp } from './ui/EditorApp';

async function initNativeEnvironment(): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      await StatusBar.setStyle({ style: Style.Dark });
      await StatusBar.hide();
    } catch {
      // Ignore if unsupported
    }
    try {
      await SplashScreen.hide({ fadeOutDuration: 250 });
    } catch {
      // Ignore
    }
  }

  // Request landscape orientation lock where supported by WebView
  try {
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (mode: string) => Promise<void>;
    };
    if (orientation?.lock) {
      await orientation.lock('landscape');
    }
  } catch {
    // Native AndroidManifest.xml and iOS Info.plist enforce landscape at OS level
  }
}

function bootstrap(): void {
  const appEl = document.getElementById('app');
  if (!appEl) return;
  new EditorApp(appEl);
  void initNativeEnvironment();
}

bootstrap();
