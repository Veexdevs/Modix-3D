import {
  fetchUnlockedOpenRouterCatalog,
  getPreferredOpenRouterModel,
  hasCustomOpenRouterKey,
  setCustomOpenRouterKey,
  setPreferredOpenRouterModel,
  UNLOCKED_FRONTIER_MODELS,
  type UnlockedAIModelOption
} from '../ai/OpenRouterAgent';
import { saveOrShareFile } from '../engine/Exporters';
import {
  getActiveLanguageInfo,
  onLanguageChange,
  openLanguageSelectorModal,
  tr
} from '../i18n/I18nService';
import { Icons } from '../icons/blenderIcons';
import {
  buildMonogramAvatarDataUrl,
  createUserProject,
  deleteAccountPermanently,
  deleteUserProject,
  fileToAvatarDataUrl,
  listUserProjects,
  renameUserProject,
  signInWithEmail,
  signOutAccount,
  signUpWithEmail,
  updateAccountProfile,
  type ModixSavedProject,
  type ModixUserAccount
} from '../services/AccountProjectsService';
import type { ModixProjectState } from '../types/scene';
import { openDropdownMenu, openTextPromptModal, showToast } from './Modals';

export interface ProjectsHubCallbacks {
  onOpenProject: (project: ModixSavedProject, account: ModixUserAccount) => void;
}

type HubSection = 'projetos' | 'recentes' | 'configuracoes' | 'sobre';

export class ProjectsHubScreen {
  private root: HTMLElement;
  private callbacks: ProjectsHubCallbacks;
  private account: ModixUserAccount | null = null;
  private authMode: 'signup' | 'signin' = 'signup';
  private authShowAbout = false;
  private hubSection: HubSection = 'projetos';
  private showSearch = false;
  private searchQuery = '';
  private showPassword = false;
  private pendingAvatarDataUrl = '';
  private draftName = '';
  private draftEmail = '';
  private draftPassword = '';
  private projects: ModixSavedProject[] = [];
  private availableModels: UnlockedAIModelOption[] = [...UNLOCKED_FRONTIER_MODELS];
  private isLoading = false;
  private authError = '';

  constructor(
    root: HTMLElement,
    initialAccount: ModixUserAccount | null,
    callbacks: ProjectsHubCallbacks
  ) {
    this.root = root;
    this.account = initialAccount;
    this.callbacks = callbacks;

    onLanguageChange(() => {
      if (!this.root.querySelector('.modix-hub-screen')) return;
      if (this.account) {
        this.renderProjectsScreen();
      } else {
        this.renderAuthScreen();
      }
    });
  }

  public async mount(account?: ModixUserAccount | null): Promise<void> {
    if (account !== undefined) {
      this.account = account;
    }
    void fetchUnlockedOpenRouterCatalog().then((list) => {
      if (list.length > this.availableModels.length) {
        this.availableModels = list;
        if (this.account && this.hubSection === 'configuracoes') {
          this.renderProjectsScreen();
        }
      }
    });

    if (!this.account) {
      this.renderAuthScreen();
      return;
    }
    this.isLoading = true;
    this.renderProjectsScreen();
    this.projects = await listUserProjects(this.account.id);
    this.isLoading = false;
    this.renderProjectsScreen();
  }

  // ==========================================================================
  // 1. MANDATORY EMAIL ACCOUNT SCREEN (Matches Exact Attached Hub Aesthetic)
  // ==========================================================================
  private renderAuthScreen(): void {
    const isSignUp = this.authMode === 'signup';
    const activeLang = getActiveLanguageInfo();
    const previewAvatar =
      this.pendingAvatarDataUrl ||
      buildMonogramAvatarDataUrl(this.draftName || 'Modix', this.draftEmail || 'user@modix');

    this.root.innerHTML = `
      <div class="modix-hub-screen">
        <!-- Left Sidebar (Identical to Projects Hub Reference) -->
        <aside class="modix-hub-sidebar">
          <div class="modix-hub-brand" data-no-i18n="true">
            <img src="./brand/modix-mark-white.png" alt="Modix" class="modix-hub-brand-mark" />
            <div class="modix-hub-brand-title" data-no-i18n="true">Modix</div>
          </div>

          <nav class="modix-hub-nav">
            <button
              type="button"
              class="modix-hub-nav-item ${!this.authShowAbout && isSignUp ? 'active' : ''}"
              data-auth-nav="signup"
            >
              <span class="modix-hub-nav-ico">${Icons.userPlus}</span>
              <span>${escapeHtml(tr('Criar Conta'))}</span>
            </button>
            <button
              type="button"
              class="modix-hub-nav-item ${!this.authShowAbout && !isSignUp ? 'active' : ''}"
              data-auth-nav="signin"
            >
              <span class="modix-hub-nav-ico">${Icons.user}</span>
              <span>${escapeHtml(tr('Entrar'))}</span>
            </button>
            <button
              type="button"
              class="modix-hub-nav-item"
              id="btn-auth-lang"
            >
              <span class="modix-hub-nav-ico">${Icons.hubGlobe}</span>
              <span>${escapeHtml(tr('Idioma'))}</span>
            </button>
            <button
              type="button"
              class="modix-hub-nav-item ${this.authShowAbout ? 'active' : ''}"
              data-auth-nav="sobre"
            >
              <span class="modix-hub-nav-ico">${Icons.hubAbout}</span>
              <span>${escapeHtml(tr('Sobre'))}</span>
            </button>
          </nav>

          <div class="modix-hub-sidebar-bottom">
            <div class="modix-hub-auth-foot-note" data-no-i18n="true">Modix 3D</div>
          </div>
        </aside>

        <!-- Right Main Area -->
        <main class="modix-hub-main">
          ${
            this.authShowAbout
              ? this.renderAboutMainHtml()
              : `
            <header class="modix-hub-header">
              <h1 class="modix-hub-heading">${escapeHtml(tr(isSignUp ? 'Criar Conta' : 'Entrar'))}</h1>
              <div class="modix-hub-header-actions">
                <button
                  type="button"
                  class="modix-hub-lang-pill"
                  id="btn-auth-lang-pill"
                  title="${escapeHtml(tr('Selecionar Idioma'))}"
                >
                  ${Icons.hubGlobe}
                  <span data-no-i18n="true">${escapeHtml(activeLang.nativeName)}</span>
                </button>
              </div>
            </header>

            <div class="modix-hub-auth-wrap">
              <div class="modix-hub-auth-card">
                <p class="modix-hub-auth-desc">
                  ${escapeHtml(
                    tr(
                      isSignUp
                        ? 'Cadastre seu email para criar sua conta e sincronizar seus projetos 3D.'
                        : 'Entre com seu email e senha para abrir seus projetos salvos.'
                    )
                  )}
                </p>

                ${
                  this.authError
                    ? `<div class="modix-hub-alert" role="alert">
                        ${Icons.alert}
                        <span>${escapeHtml(this.authError)}</span>
                       </div>`
                    : ''
                }

                <form id="modix-auth-form" class="modix-hub-auth-form" novalidate>
                  ${
                    isSignUp
                      ? `
                      <div class="modix-hub-avatar-picker">
                        <img
                          src="${escapeHtml(previewAvatar)}"
                          alt="Profile"
                          class="modix-hub-avatar-img"
                        />
                        <div class="modix-hub-avatar-meta">
                          <span class="modix-hub-avatar-lbl">${escapeHtml(tr('Foto de perfil (opcional)'))}</span>
                          <button type="button" class="modix-hub-btn-subtle" id="btn-pick-auth-avatar">
                            ${Icons.cameraPhoto}<span>${escapeHtml(tr('Escolher foto'))}</span>
                          </button>
                          <input type="file" id="inp-auth-avatar" accept="image/*" style="display:none;" />
                        </div>
                      </div>

                      <label class="modix-hub-field">
                        <span class="modix-hub-field-label">${escapeHtml(tr('Nome'))}</span>
                        <div class="modix-hub-input-box">
                          <span class="modix-hub-input-ico">${Icons.user}</span>
                          <input
                            type="text"
                            id="auth-name"
                            value="${escapeHtml(this.draftName)}"
                            placeholder="${escapeHtml(tr('Seu nome ou estúdio'))}"
                            autocomplete="name"
                          />
                        </div>
                      </label>
                    `
                      : ''
                  }

                  <label class="modix-hub-field">
                    <span class="modix-hub-field-label">${escapeHtml(tr('Email'))}</span>
                    <div class="modix-hub-input-box">
                      <span class="modix-hub-input-ico">${Icons.mail}</span>
                      <input
                        type="email"
                        id="auth-email"
                        value="${escapeHtml(this.draftEmail)}"
                        placeholder="${escapeHtml(tr('voce@email.com'))}"
                        autocomplete="email"
                        required
                      />
                    </div>
                  </label>

                  <label class="modix-hub-field">
                    <span class="modix-hub-field-label">${escapeHtml(tr('Senha'))}</span>
                    <div class="modix-hub-input-box">
                      <span class="modix-hub-input-ico">${Icons.lock}</span>
                      <input
                        type="${this.showPassword ? 'text' : 'password'}"
                        id="auth-password"
                        value="${escapeHtml(this.draftPassword)}"
                        placeholder="${escapeHtml(tr(isSignUp ? 'Mínimo de 6 caracteres' : 'Sua senha'))}"
                        autocomplete="${isSignUp ? 'new-password' : 'current-password'}"
                        required
                      />
                      <button
                        type="button"
                        class="modix-hub-eye-btn"
                        id="btn-toggle-pass"
                        title="${escapeHtml(tr(this.showPassword ? 'Ocultar senha' : 'Mostrar senha'))}"
                      >
                        ${this.showPassword ? Icons.eyeClosed : Icons.eyeOpen}
                      </button>
                    </div>
                  </label>

                  <div class="modix-hub-auth-actions">
                    <button type="submit" class="modix-hub-submit-btn" ${this.isLoading ? 'disabled' : ''}>
                      ${
                        this.isLoading
                          ? `<span class="modix-btn-spinner"></span><span>${escapeHtml(tr('Conectando...'))}</span>`
                          : `<span>${escapeHtml(tr(isSignUp ? 'Criar Conta e Entrar' : 'Entrar na Conta'))}</span>`
                      }
                    </button>

                    <button type="button" class="modix-hub-switch-link" id="btn-switch-auth-mode">
                      ${escapeHtml(
                        tr(
                          isSignUp
                            ? 'Já possui uma conta? Entrar'
                            : 'Ainda não tem conta? Criar Conta'
                        )
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          `
          }
        </main>
      </div>
    `;

    const captureDrafts = () => {
      const nameEl = this.root.querySelector<HTMLInputElement>('#auth-name');
      const emailEl = this.root.querySelector<HTMLInputElement>('#auth-email');
      const passEl = this.root.querySelector<HTMLInputElement>('#auth-password');
      if (nameEl) this.draftName = nameEl.value;
      if (emailEl) this.draftEmail = emailEl.value;
      if (passEl) this.draftPassword = passEl.value;
    };

    const openLangPicker = () => {
      captureDrafts();
      openLanguageSelectorModal();
    };
    this.root.querySelector('#btn-auth-lang')?.addEventListener('click', openLangPicker);
    this.root.querySelector('#btn-auth-lang-pill')?.addEventListener('click', openLangPicker);

    this.root.querySelectorAll<HTMLButtonElement>('[data-auth-nav]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (this.isLoading) return;
        captureDrafts();
        const target = btn.dataset.authNav;
        this.authError = '';
        if (target === 'sobre') {
          this.authShowAbout = true;
        } else {
          this.authShowAbout = false;
          this.authMode = target === 'signin' ? 'signin' : 'signup';
        }
        this.renderAuthScreen();
      });
    });

    this.root.querySelector('#btn-switch-auth-mode')?.addEventListener('click', () => {
      if (this.isLoading) return;
      captureDrafts();
      this.authError = '';
      this.authMode = isSignUp ? 'signin' : 'signup';
      this.renderAuthScreen();
    });

    this.root.querySelector('#btn-toggle-pass')?.addEventListener('click', () => {
      captureDrafts();
      this.showPassword = !this.showPassword;
      this.renderAuthScreen();
    });

    const pickAvatarBtn = this.root.querySelector<HTMLButtonElement>('#btn-pick-auth-avatar');
    const avatarInput = this.root.querySelector<HTMLInputElement>('#inp-auth-avatar');
    if (pickAvatarBtn && avatarInput) {
      pickAvatarBtn.addEventListener('click', () => avatarInput.click());
      avatarInput.addEventListener('change', async () => {
        const file = avatarInput.files?.[0];
        avatarInput.value = '';
        if (!file) return;
        try {
          captureDrafts();
          this.pendingAvatarDataUrl = await fileToAvatarDataUrl(file);
          this.renderAuthScreen();
        } catch (err) {
          showToast(err instanceof Error ? err.message : tr('Erro'));
        }
      });
    }

    const form = this.root.querySelector<HTMLFormElement>('#modix-auth-form');
    form?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (this.isLoading) return;

      captureDrafts();
      const email = this.draftEmail.trim();
      const password = this.draftPassword;
      const name = this.draftName.trim();

      this.authError = '';
      this.isLoading = true;
      this.renderAuthScreen();

      try {
        const acc =
          this.authMode === 'signup'
            ? await signUpWithEmail(email, password, name, this.pendingAvatarDataUrl || undefined)
            : await signInWithEmail(email, password);
        this.account = acc;
        this.pendingAvatarDataUrl = '';
        this.draftPassword = '';
        this.hubSection = 'projetos';
        this.isLoading = false;
        await this.mount(acc);
      } catch (err) {
        this.isLoading = false;
        this.authError = err instanceof Error ? err.message : tr('Erro');
        this.renderAuthScreen();
      }
    });
  }

  // ==========================================================================
  // 2. STARTUP PROJECTS SCREEN (Identical to User Reference Screenshot)
  // ==========================================================================
  private renderProjectsScreen(): void {
    const acc = this.account;
    if (!acc) {
      this.renderAuthScreen();
      return;
    }

    this.root.innerHTML = `
      <div class="modix-hub-screen">
        <input type="file" id="hub-avatar-file" accept="image/*" style="display:none;" />
        <input type="file" id="hub-import-modix" accept=".modix,.json" style="display:none;" />

        <!-- Left Navigation Sidebar -->
        <aside class="modix-hub-sidebar">
          <div class="modix-hub-brand" data-no-i18n="true">
            <img src="./brand/modix-mark-white.png" alt="Modix" class="modix-hub-brand-mark" />
            <div class="modix-hub-brand-title" data-no-i18n="true">Modix</div>
          </div>

          <nav class="modix-hub-nav">
            <button
              type="button"
              class="modix-hub-nav-item ${this.hubSection === 'projetos' ? 'active' : ''}"
              data-hub-nav="projetos"
            >
              <span class="modix-hub-nav-ico">${Icons.hubHome}</span>
              <span>${escapeHtml(tr('Projetos'))}</span>
            </button>
            <button
              type="button"
              class="modix-hub-nav-item ${this.hubSection === 'recentes' ? 'active' : ''}"
              data-hub-nav="recentes"
            >
              <span class="modix-hub-nav-ico">${Icons.hubRecents}</span>
              <span>${escapeHtml(tr('Recentes'))}</span>
            </button>
            <button
              type="button"
              class="modix-hub-nav-item"
              id="btn-hub-sidebar-lang"
            >
              <span class="modix-hub-nav-ico">${Icons.hubGlobe}</span>
              <span>${escapeHtml(tr('Idioma'))}</span>
            </button>
            <button
              type="button"
              class="modix-hub-nav-item ${this.hubSection === 'configuracoes' ? 'active' : ''}"
              data-hub-nav="configuracoes"
            >
              <span class="modix-hub-nav-ico">${Icons.hubSettings}</span>
              <span>${escapeHtml(tr('Configurações'))}</span>
            </button>
            <button
              type="button"
              class="modix-hub-nav-item ${this.hubSection === 'sobre' ? 'active' : ''}"
              data-hub-nav="sobre"
            >
              <span class="modix-hub-nav-ico">${Icons.hubAbout}</span>
              <span>${escapeHtml(tr('Sobre'))}</span>
            </button>
          </nav>

          <div class="modix-hub-sidebar-bottom">
            <button type="button" class="modix-hub-logout-btn" id="btn-hub-logout">
              <span class="modix-hub-nav-ico">${Icons.hubLogout}</span>
              <span>${escapeHtml(tr('Sair'))}</span>
            </button>
          </div>
        </aside>

        <!-- Right Main Workspace -->
        <main class="modix-hub-main">
          ${
            this.hubSection === 'configuracoes'
              ? this.renderSettingsMainHtml(acc)
              : this.hubSection === 'sobre'
                ? this.renderAboutMainHtml()
                : this.renderProjectsMainHtml()
          }
        </main>
      </div>
    `;

    this.bindProjectsScreenEvents();
  }

  private renderProjectsMainHtml(): string {
    const isRecents = this.hubSection === 'recentes';
    const activeLang = getActiveLanguageInfo();
    const q = this.searchQuery.trim().toLowerCase();

    let list = [...this.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (isRecents) {
      list = list.slice(0, 12);
    }
    if (q) {
      list = list.filter((p) => p.name.toLowerCase().includes(q));
    }

    return `
      <header class="modix-hub-header">
        <h1 class="modix-hub-heading">${escapeHtml(tr(isRecents ? 'Recentes' : 'Projetos'))}</h1>

        <div class="modix-hub-header-actions">
          ${
            this.showSearch
              ? `<div class="modix-hub-search-box">
                  <input
                    type="text"
                    id="hub-search-input"
                    value="${escapeHtml(this.searchQuery)}"
                    placeholder="${escapeHtml(tr('Buscar projeto...'))}"
                    autocomplete="off"
                  />
                 </div>`
              : ''
          }
          <button
            type="button"
            class="modix-hub-lang-pill"
            id="btn-hub-header-lang"
            title="${escapeHtml(tr('Selecionar Idioma'))}"
          >
            ${Icons.hubGlobe}
            <span data-no-i18n="true">${escapeHtml(activeLang.nativeName)}</span>
          </button>
          <button
            type="button"
            class="modix-hub-search-btn ${this.showSearch ? 'active' : ''}"
            id="btn-hub-search"
            title="${escapeHtml(tr('Buscar projetos'))}"
          >
            ${Icons.hubSearch}
          </button>
          <button
            type="button"
            class="modix-hub-plus-btn"
            id="btn-create-project-top"
            title="${escapeHtml(tr('Novo Projeto 3D'))}"
          >
            ${Icons.plus}
          </button>
        </div>
      </header>

      ${
        this.isLoading
          ? `<div class="modix-hub-empty-state">
              <div class="modix-btn-spinner"></div>
              <span>${escapeHtml(tr('Carregando seus projetos...'))}</span>
             </div>`
          : list.length === 0
            ? `<div class="modix-hub-empty-state">
                <div class="modix-hub-empty-title">
                  ${escapeHtml(
                    tr(
                      q
                        ? 'Nenhum projeto encontrado para esta busca.'
                        : 'Nenhum projeto na sua conta ainda.'
                    )
                  )}
                </div>
                <div class="modix-hub-empty-sub">
                  ${escapeHtml(
                    tr(
                      q
                        ? 'Tente outro termo ou limpe o filtro de pesquisa.'
                        : 'Toque no botão + acima para criar seu primeiro projeto 3D ou importar um arquivo .MODIX.'
                    )
                  )}
                </div>
                ${
                  !q
                    ? `<button type="button" class="modix-hub-empty-btn" id="btn-create-project-empty">
                        ${Icons.plus}<span>${escapeHtml(tr('Novo Projeto'))}</span>
                       </button>`
                    : ''
                }
               </div>`
            : `<div class="modix-hub-grid">
                ${list.map((p) => this.renderProjectCardHtml(p)).join('')}
               </div>`
      }
    `;
  }

  private renderProjectCardHtml(proj: ModixSavedProject): string {
    const formattedDate = formatHubCardDate(proj.updatedAt);
    const countLabel = `${proj.objectCount} obj`;
    const metaLine = formattedDate ? `${formattedDate} \u2022 ${countLabel}` : countLabel;

    return `
      <div class="modix-hub-card" data-project-id="${escapeHtml(proj.id)}">
        <div class="modix-hub-card-thumb">
          ${
            proj.thumbnailUrl
              ? `<img src="${proj.thumbnailUrl}" alt="${escapeHtml(proj.name)}" data-no-i18n="true" />`
              : `<div class="modix-hub-card-placeholder">
                  <div class="modix-hub-card-grid"></div>
                  ${Icons.file3d}
                 </div>`
          }
        </div>
        <div class="modix-hub-card-footer">
          <div class="modix-hub-card-info">
            <div class="modix-hub-card-title" data-no-i18n="true" title="${escapeHtml(proj.name)}">${escapeHtml(proj.name)}</div>
            <div class="modix-hub-card-sub" data-no-i18n="true">
              <span class="modix-hub-card-cal">${Icons.hubCalendar}</span>
              <span>${escapeHtml(metaLine)}</span>
            </div>
          </div>
          <button
            type="button"
            class="modix-hub-card-more"
            data-proj-more
            title="${escapeHtml(tr('Opções do projeto'))}"
          >
            ${Icons.moreDots}
          </button>
        </div>
      </div>
    `;
  }

  private renderSettingsMainHtml(acc: ModixUserAccount): string {
    const fallbackAvatar = buildMonogramAvatarDataUrl(acc.name, acc.email);
    const customKeyActive = hasCustomOpenRouterKey();
    const activeLang = getActiveLanguageInfo();
    const preferredModel = getPreferredOpenRouterModel();

    return `
      <header class="modix-hub-header">
        <h1 class="modix-hub-heading">${escapeHtml(tr('Configurações'))}</h1>
      </header>

      <div class="modix-hub-settings-stack">
        <!-- Logged-in Account Profile Card (User Name & Email Strictly Protected) -->
        <section class="modix-hub-settings-card">
          <div class="modix-hub-profile-row">
            <img
              src="${escapeHtml(acc.avatarUrl || fallbackAvatar)}"
              data-fallback="${escapeHtml(fallbackAvatar)}"
              alt="${escapeHtml(acc.name)}"
              data-no-i18n="true"
              class="modix-hub-profile-avatar"
              id="hub-account-avatar-img"
            />
            <div class="modix-hub-profile-meta" data-no-i18n="true">
              <div class="modix-hub-profile-name" data-no-i18n="true">${escapeHtml(acc.name)}</div>
              <div class="modix-hub-profile-email" data-no-i18n="true">${escapeHtml(acc.email)}</div>
            </div>
          </div>

          <div class="modix-hub-settings-actions">
            <button type="button" class="modix-hub-btn-subtle" id="btn-settings-avatar">
              ${Icons.cameraPhoto}<span>${escapeHtml(tr('Alterar Foto'))}</span>
            </button>
            <button type="button" class="modix-hub-btn-subtle" id="btn-settings-name">
              ${Icons.edit}<span>${escapeHtml(tr('Editar Nome'))}</span>
            </button>
            <button type="button" class="modix-hub-btn-subtle" id="btn-settings-import">
              ${Icons.upload}<span>${escapeHtml(tr('Importar .MODIX'))}</span>
            </button>
          </div>
        </section>

        <!-- App Language Selector Card -->
        <section class="modix-hub-settings-card">
          <div class="modix-hub-settings-title">${escapeHtml(tr('Idioma'))}</div>
          <div class="modix-hub-settings-actions" style="margin-top:8px;">
            <button type="button" class="modix-hub-btn-subtle" id="btn-settings-lang">
              ${Icons.hubGlobe}
              <span data-no-i18n="true">${escapeHtml(activeLang.nativeName)} (${escapeHtml(activeLang.enName)})</span>
            </button>
          </div>
        </section>

        <!-- OpenRouter Frontier AI Models & Key Card -->
        <section class="modix-hub-settings-card">
          <div class="modix-hub-settings-title">${escapeHtml(tr('IA & Agente OpenRouter'))}</div>
          <p class="modix-hub-settings-sub">
            ${escapeHtml(
              tr(
                customKeyActive
                  ? 'Chave personalizada OpenRouter ativa neste dispositivo.'
                  : 'Chave integrada ativa por padrão. Opcionalmente informe sua própria chave OpenRouter.'
              )
            )}
          </p>

          <div style="margin-top:10px;">
            <div class="modix-hub-field-label" style="margin-bottom:6px;">${escapeHtml(tr('Modelo de IA (OpenRouter)'))}</div>
            <select id="hub-model-select" class="modix-hub-model-select" data-no-i18n="true">
              ${this.availableModels
                .map((m) => {
                  const label =
                    m.id === 'auto'
                      ? tr('Auto (Melhores IAs do Mundo em Conjunto)')
                      : `${m.label} — ${m.provider}`;
                  return `<option value="${escapeHtml(m.id)}" ${preferredModel === m.id ? 'selected' : ''}>${escapeHtml(label)}</option>`;
                })
                .join('')}
            </select>
          </div>

          <div class="modix-hub-key-row">
            <input
              type="password"
              id="hub-openrouter-key"
              class="modix-hub-key-input"
              data-no-i18n="true"
              placeholder="${escapeHtml(tr('Opcional: sk-or-v1-...'))}"
              autocomplete="off"
            />
            <button type="button" class="modix-hub-btn-subtle" id="btn-hub-save-key">${escapeHtml(tr('Salvar'))}</button>
            ${
              customKeyActive
                ? `<button type="button" class="modix-hub-btn-subtle" id="btn-hub-reset-key">${escapeHtml(tr('Padrão'))}</button>`
                : ''
            }
          </div>
        </section>

        <!-- Danger Zone: Delete Account -->
        <section class="modix-hub-settings-card danger-zone">
          <div class="modix-hub-settings-title">${escapeHtml(tr('Zona da Conta'))}</div>
          <p class="modix-hub-settings-sub" data-no-i18n="true">
            ${escapeHtml(acc.email)}
          </p>
          <div class="modix-hub-settings-actions">
            <button type="button" class="modix-hub-btn-danger" id="btn-settings-delete-account">
              ${Icons.userDelete}<span>${escapeHtml(tr('Deletar Conta Permanentemente'))}</span>
            </button>
          </div>
        </section>
      </div>
    `;
  }

  private renderAboutMainHtml(): string {
    return `
      <header class="modix-hub-header">
        <h1 class="modix-hub-heading">${escapeHtml(tr('Sobre'))}</h1>
      </header>

      <div class="modix-hub-settings-stack">
        <section class="modix-hub-settings-card">
          <div class="modix-hub-settings-title" data-no-i18n="true">Modix 3D</div>
          <p class="modix-hub-settings-sub">
            ${escapeHtml(
              tr(
                'Estúdio 3D completo em modo paisagem para modelagem poligonal, curvas Loft & Sweep, escultura dinâmica, pintura PBR de texturas, animação por keyframes e Agente Multi-IA com fidelidade visual por múltiplas referências.'
              )
            )}
          </p>
          <p class="modix-hub-settings-sub" style="margin-top:10px;" data-no-i18n="true">
            .GLB · .GLTF · .OBJ · .USDZ · .STL · .PLY · .DAE · .MODIX
          </p>
        </section>
      </div>
    `;
  }

  private bindProjectsScreenEvents(): void {
    const avatarImg = this.root.querySelector<HTMLImageElement>('#hub-account-avatar-img');
    avatarImg?.addEventListener('error', () => {
      const fb = avatarImg.dataset.fallback;
      if (fb && avatarImg.src !== fb) {
        avatarImg.src = fb;
      }
    });

    const avatarInput = this.root.querySelector<HTMLInputElement>('#hub-avatar-file');
    const importModixInput = this.root.querySelector<HTMLInputElement>('#hub-import-modix');

    const openLang = () => openLanguageSelectorModal();
    this.root.querySelector('#btn-hub-sidebar-lang')?.addEventListener('click', openLang);
    this.root.querySelector('#btn-hub-header-lang')?.addEventListener('click', openLang);
    this.root.querySelector('#btn-settings-lang')?.addEventListener('click', openLang);

    this.root.querySelectorAll<HTMLButtonElement>('[data-hub-nav]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nav = (btn.dataset.hubNav as HubSection) || 'projetos';
        this.hubSection = nav;
        this.renderProjectsScreen();
      });
    });

    this.root.querySelector('#btn-hub-logout')?.addEventListener('click', async () => {
      await signOutAccount();
      this.account = null;
      this.projects = [];
      this.authMode = 'signin';
      this.authShowAbout = false;
      this.renderAuthScreen();
      showToast(tr('Você saiu da conta.'));
    });

    this.root.querySelector('#btn-hub-search')?.addEventListener('click', () => {
      this.showSearch = !this.showSearch;
      if (!this.showSearch) {
        this.searchQuery = '';
      }
      this.renderProjectsScreen();
      if (this.showSearch) {
        this.root.querySelector<HTMLInputElement>('#hub-search-input')?.focus();
      }
    });

    const searchInput = this.root.querySelector<HTMLInputElement>('#hub-search-input');
    searchInput?.addEventListener('input', () => {
      const pos = searchInput.selectionStart ?? searchInput.value.length;
      this.searchQuery = searchInput.value;
      this.renderProjectsScreen();
      const nextInput = this.root.querySelector<HTMLInputElement>('#hub-search-input');
      if (nextInput) {
        nextInput.focus();
        nextInput.setSelectionRange(pos, pos);
      }
    });

    avatarInput?.addEventListener('change', async () => {
      const f = avatarInput.files?.[0];
      avatarInput.value = '';
      if (!f || !this.account) return;
      try {
        const dataUrl = await fileToAvatarDataUrl(f);
        this.account = await updateAccountProfile(this.account, { avatarUrl: dataUrl });
        this.renderProjectsScreen();
        showToast(tr('Foto do perfil atualizada.'));
      } catch (err) {
        showToast(err instanceof Error ? err.message : tr('Erro'));
      }
    });

    importModixInput?.addEventListener('change', async () => {
      const f = importModixInput.files?.[0];
      importModixInput.value = '';
      if (!f || !this.account) return;
      try {
        const text = await f.text();
        const parsed = JSON.parse(text) as ModixProjectState;
        if (!parsed || !Array.isArray(parsed.objects)) {
          throw new Error('Invalid .MODIX');
        }
        // Preserve exact filename stem chosen by user!
        const baseName = f.name.replace(/\.(modix|json)$/i, '') || f.name;
        const created = await createUserProject(this.account.id, baseName, parsed);
        this.projects.unshift(created);
        this.callbacks.onOpenProject(created, this.account);
      } catch (err) {
        showToast(err instanceof Error ? err.message : tr('Erro'));
      }
    });

    // Settings actions
    this.root.querySelector('#btn-settings-avatar')?.addEventListener('click', () => {
      avatarInput?.click();
    });

    this.root.querySelector('#btn-settings-name')?.addEventListener('click', () => {
      if (!this.account) return;
      openTextPromptModal({
        title: tr('Editar Nome da Conta'),
        label: tr('Seu nome de exibição:'),
        initialValue: this.account.name,
        confirmLabel: tr('Salvar'),
        onConfirm: async (newName) => {
          if (!this.account) return;
          this.account = await updateAccountProfile(this.account, { name: newName });
          this.renderProjectsScreen();
          showToast(tr('Nome atualizado.'));
        }
      });
    });

    this.root.querySelector('#btn-settings-import')?.addEventListener('click', () => {
      importModixInput?.click();
    });

    this.root
      .querySelector<HTMLSelectElement>('#hub-model-select')
      ?.addEventListener('change', (e) => {
        const val = (e.target as HTMLSelectElement).value || 'auto';
        setPreferredOpenRouterModel(val);
      });

    this.root.querySelector('#btn-hub-save-key')?.addEventListener('click', () => {
      const keyInp = this.root.querySelector<HTMLInputElement>('#hub-openrouter-key');
      const val = keyInp?.value.trim() || '';
      if (!val) return;
      setCustomOpenRouterKey(val);
      this.renderProjectsScreen();
      showToast(tr('Salvar'));
    });

    this.root.querySelector('#btn-hub-reset-key')?.addEventListener('click', () => {
      setCustomOpenRouterKey('');
      this.renderProjectsScreen();
    });

    this.root.querySelector('#btn-settings-delete-account')?.addEventListener('click', () => {
      this.openDeleteAccountConfirmModal();
    });

    const triggerCreateProject = () => {
      if (!this.account) return;
      const nextIndex = this.projects.length + 1;
      openTextPromptModal({
        title: tr('Novo Projeto'),
        label: tr('Nome do projeto:'),
        initialValue: `Project ${nextIndex}`,
        placeholder: tr('Ex: Personagem, Carro, Cenário...'),
        confirmLabel: tr('Criar e Abrir'),
        extraActionLabel: tr('Importar .MODIX'),
        onExtraAction: () => importModixInput?.click(),
        onConfirm: async (projectName) => {
          if (!this.account) return;
          const created = await createUserProject(this.account.id, projectName);
          this.projects.unshift(created);
          this.callbacks.onOpenProject(created, this.account);
        }
      });
    };

    this.root
      .querySelector('#btn-create-project-top')
      ?.addEventListener('click', triggerCreateProject);
    this.root
      .querySelector('#btn-create-project-empty')
      ?.addEventListener('click', triggerCreateProject);

    this.root.querySelectorAll<HTMLElement>('[data-project-id]').forEach((card) => {
      const pid = card.dataset.projectId!;
      const proj = this.projects.find((p) => p.id === pid);
      if (!proj) return;

      const moreBtn = card.querySelector<HTMLButtonElement>('[data-proj-more]');
      moreBtn?.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (!this.account) return;
        openDropdownMenu(moreBtn, [
          {
            label: tr('Abrir Projeto'),
            icon: Icons.folderOpen,
            onClick: () => {
              if (this.account) this.callbacks.onOpenProject(proj, this.account);
            }
          },
          {
            label: tr('Renomear Projeto...'),
            icon: Icons.edit,
            onClick: () => {
              openTextPromptModal({
                title: tr('Renomear Projeto'),
                label: tr('Novo nome:'),
                initialValue: proj.name,
                confirmLabel: tr('Salvar'),
                onConfirm: async (newName) => {
                  if (!this.account) return;
                  await renameUserProject(proj.id, this.account.id, newName);
                  proj.name = newName;
                  proj.projectData.sceneName = newName;
                  this.renderProjectsScreen();
                  showToast(tr('Projeto renomeado.'));
                }
              });
            }
          },
          {
            label: tr('Duplicar Projeto'),
            icon: Icons.copy,
            onClick: async () => {
              if (!this.account) return;
              const copyState = JSON.parse(JSON.stringify(proj.projectData)) as ModixProjectState;
              const dup = await createUserProject(
                this.account.id,
                `${proj.name} (2)`,
                copyState,
                proj.thumbnailUrl
              );
              this.projects.unshift(dup);
              this.renderProjectsScreen();
              showToast(tr('Projeto duplicado.'));
            }
          },
          {
            label: tr('Exportar .MODIX'),
            icon: Icons.download,
            onClick: async () => {
              const json = JSON.stringify(proj.projectData, null, 2);
              const safe = (proj.name || 'project').replace(/[^a-zA-Z0-9_-]+/g, '_');
              const msg = await saveOrShareFile(`${safe}.modix`, json, 'application/json');
              showToast(msg);
            }
          },
          { divider: true },
          {
            label: tr('Excluir Projeto'),
            icon: Icons.trash,
            danger: true,
            onClick: async () => {
              if (!this.account) return;
              await deleteUserProject(proj.id, this.account.id);
              this.projects = this.projects.filter((x) => x.id !== proj.id);
              this.renderProjectsScreen();
              showToast(tr('Projeto excluído.'));
            }
          }
        ]);
      });

      card.addEventListener('click', () => {
        if (this.account) {
          this.callbacks.onOpenProject(proj, this.account);
        }
      });
    });
  }

  private openDeleteAccountConfirmModal(): void {
    const acc = this.account;
    if (!acc) return;

    const backdrop = document.createElement('div');
    backdrop.className = 'modix-modal-backdrop';
    backdrop.innerHTML = `
      <div class="modix-prompt-card">
        <div class="modix-modal-header">
          <span style="display:inline-flex;align-items:center;gap:6px;color:#fca5a5;font-weight:700;">
            ${Icons.userDelete}<span>${escapeHtml(tr('Deletar Conta Permanentemente'))}</span>
          </span>
          <button type="button" class="modix-modal-close" data-close>${Icons.close}</button>
        </div>
        <div class="modix-prompt-body">
          <p style="margin:0;font-size:12px;color:#d4d4d8;line-height:1.5;">
            <strong style="color:#ffffff;" data-no-i18n="true">${escapeHtml(acc.email)}</strong>
          </p>
        </div>
        <div class="modix-prompt-footer">
          <button type="button" class="modix-btn-sm" data-close>${escapeHtml(tr('Cancelar'))}</button>
          <button type="button" class="modix-btn-sm danger" id="btn-confirm-del-acc">
            ${Icons.trash}<span>${escapeHtml(tr('Deletar Conta'))}</span>
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    const close = () => backdrop.remove();
    backdrop.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close();
    });

    const confirmBtn = backdrop.querySelector<HTMLButtonElement>('#btn-confirm-del-acc');
    confirmBtn?.addEventListener('click', async () => {
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = `<span class="modix-btn-spinner"></span><span>${escapeHtml(tr('Excluindo...'))}</span>`;
      try {
        await deleteAccountPermanently(acc.id);
        close();
        this.account = null;
        this.projects = [];
        this.authMode = 'signup';
        this.authShowAbout = false;
        this.renderAuthScreen();
        showToast(tr('Sua conta e seus projetos foram excluídos.'));
      } catch (err) {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = `${Icons.trash}<span>${escapeHtml(tr('Deletar Conta'))}</span>`;
        showToast(err instanceof Error ? err.message : tr('Erro'));
      }
    });
  }
}

function formatHubCardDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${day}/${month}, ${hours}:${mins}`;
  } catch {
    return '';
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
