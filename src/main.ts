import { Capacitor } from '@capacitor/core';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { installDomI18nObserver, refreshEntireDocumentLanguage } from './i18n/I18nService';
import { getCurrentAccount, type ModixSavedProject, type ModixUserAccount } from './services/AccountProjectsService';
import './styles/editor.css';
import { EditorApp } from './ui/EditorApp';
import { ProjectsHubScreen } from './ui/ProjectsHubScreen';

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

async function bootstrap(): Promise<void> {
  const appEl = document.getElementById('app');
  if (!appEl) return;

  installDomI18nObserver();
  void initNativeEnvironment();

  let activeEditor: EditorApp | null = null;
  let hubScreen: ProjectsHubScreen | null = null;

  const showProjectsHub = async () => {
    if (activeEditor) {
      activeEditor.destroy();
      activeEditor = null;
    }
    const account = await getCurrentAccount();
    hubScreen = new ProjectsHubScreen(appEl, account, {
      onOpenProject: (project: ModixSavedProject, acc: ModixUserAccount) => {
        openEditorForProject(project, acc);
      }
    });
    await hubScreen.mount(account);
    refreshEntireDocumentLanguage();
  };

  const openEditorForProject = (project: ModixSavedProject, account: ModixUserAccount) => {
    hubScreen = null;
    activeEditor = new EditorApp(appEl, {
      project,
      account,
      onBackToProjects: () => {
        void showProjectsHub();
      }
    });
  };

  // Mandatory: ALWAYS start on Account Creation/Sign-In -> Projects Screen when opening the app
  await showProjectsHub();
}

void bootstrap();
