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

export class ProjectsHubScreen {
  private root: HTMLElement;
  private callbacks: ProjectsHubCallbacks;
  private account: ModixUserAccount | null = null;
  private authMode: 'signup' | 'signin' = 'signup';
  private showPassword = false;
  private pendingAvatarDataUrl = '';
  private draftName = '';
  private draftEmail = '';
  private draftPassword = '';
  private projects: ModixSavedProject[] = [];
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
  }

  public async mount(account?: ModixUserAccount | null): Promise<void> {
    if (account !== undefined) {
      this.account = account;
    }
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
  // 1. MANDATORY EMAIL ACCOUNT CREATION / SIGN-IN SCREEN (Landscape Studio UI)
  // ==========================================================================
  private renderAuthScreen(): void {
    const isSignUp = this.authMode === 'signup';

    this.root.innerHTML = `
      <div class="modix-auth-screen">
        <div class="modix-auth-bg-grid" aria-hidden="true"></div>

        <div class="modix-auth-panel">
          <!-- Left Studio Brand Showcase -->
          <div class="modix-auth-showcase">
            <div class="modix-auth-brand-top">
              <div class="modix-auth-logo-box">
                <img src="./brand/modix-mark-white.png" alt="Modix 3D" class="modix-auth-logo" />
              </div>
              <div>
                <div class="modix-auth-wordmark-row">
                  <h1 class="modix-auth-title">Modix 3D</h1>
                  <span class="modix-auth-studio-tag">STUDIO</span>
                </div>
                <p class="modix-auth-tagline">Modelagem 3D, Escultura, Pintura PBR &amp; Agente Multi-IA</p>
              </div>
            </div>

            <div class="modix-auth-feature-list">
              <div class="modix-auth-feature-item">
                <span class="modix-auth-feat-ico">${Icons.scanEye}</span>
                <div>
                  <div class="modix-auth-feat-title">Agente 3D com Múltiplas Referências</div>
                  <div class="modix-auth-feat-sub">Envie fotos de frente, lado e detalhes para réplica 3D fiel</div>
                </div>
              </div>

              <div class="modix-auth-feature-item">
                <span class="modix-auth-feat-ico">${Icons.file3d}</span>
                <div>
                  <div class="modix-auth-feat-title">Exportação 3D Universal</div>
                  <div class="modix-auth-feat-sub">.OBJ, .GLB, .GLTF, .USDZ, .STL, .PLY, .DAE e .PNG</div>
                </div>
              </div>

              <div class="modix-auth-feature-item">
                <span class="modix-auth-feat-ico">${Icons.cloudCheck}</span>
                <div>
                  <div class="modix-auth-feat-title">Projetos Salvos na Sua Conta</div>
                  <div class="modix-auth-feat-sub">Sincronização automática vinculada ao seu e-mail</div>
                </div>
              </div>
            </div>
          </div>

          <!-- Right Auth Form Card -->
          <div class="modix-auth-card">
            <div class="modix-auth-tabs" role="tablist">
              <button type="button" class="modix-auth-tab ${isSignUp ? 'active' : ''}" data-auth-tab="signup">
                ${Icons.user}<span>Criar Conta</span>
              </button>
              <button type="button" class="modix-auth-tab ${!isSignUp ? 'active' : ''}" data-auth-tab="signin">
                ${Icons.lock}<span>Entrar</span>
              </button>
            </div>

            ${
              this.authError
                ? `<div class="modix-auth-error">${Icons.alert}<span>${escapeHtml(this.authError)}</span></div>`
                : ''
            }

            <form class="modix-auth-form" id="modix-auth-form" novalidate>
              ${
                isSignUp
                  ? `
                <div class="modix-auth-profile-row">
                  <button type="button" class="modix-auth-avatar-btn" id="btn-pick-avatar" title="Escolher foto do perfil">
                    ${
                      this.pendingAvatarDataUrl
                        ? `<img src="${this.pendingAvatarDataUrl}" alt="Foto" />`
                        : `<span class="modix-auth-avatar-empty">${Icons.cameraPhoto}</span>`
                    }
                  </button>
                  <input type="file" id="input-auth-avatar" accept="image/*" style="display:none;" />

                  <label class="modix-auth-field" style="flex:1;min-width:0;">
                    <span class="modix-auth-field-lbl">Seu Nome</span>
                    <div class="modix-auth-input-wrap">
                      ${Icons.user}
                      <input
                        type="text"
                        id="auth-name"
                        value="${escapeHtml(this.draftName)}"
                        placeholder="Como quer ser chamado"
                        autocomplete="name"
                        required
                      />
                    </div>
                  </label>
                </div>
              `
                  : ''
              }

              <label class="modix-auth-field">
                <span class="modix-auth-field-lbl">E-mail da Conta</span>
                <div class="modix-auth-input-wrap">
                  ${Icons.mail}
                  <input
                    type="email"
                    id="auth-email"
                    value="${escapeHtml(this.draftEmail)}"
                    placeholder="seuemail@exemplo.com"
                    autocomplete="email"
                    required
                  />
                </div>
              </label>

              <label class="modix-auth-field">
                <span class="modix-auth-field-lbl">Senha</span>
                <div class="modix-auth-input-wrap">
                  ${Icons.lock}
                  <input
                    type="${this.showPassword ? 'text' : 'password'}"
                    id="auth-password"
                    value="${escapeHtml(this.draftPassword)}"
                    placeholder="Mínimo de 6 caracteres"
                    autocomplete="${isSignUp ? 'new-password' : 'current-password'}"
                    required
                  />
                  <button
                    type="button"
                    class="modix-auth-eye-btn"
                    id="btn-toggle-pwd"
                    title="${this.showPassword ? 'Ocultar senha' : 'Mostrar senha'}"
                  >
                    ${this.showPassword ? Icons.eyeClosed : Icons.eyeOpen}
                  </button>
                </div>
              </label>

              <button type="submit" class="modix-auth-submit" id="btn-auth-submit" ${
                this.isLoading ? 'disabled' : ''
              }>
                ${
                  this.isLoading
                    ? `<span class="modix-btn-spinner"></span><span>Autenticando...</span>`
                    : `${isSignUp ? Icons.check : Icons.arrowRight}<span>${
                        isSignUp ? 'Criar Conta com E-mail' : 'Entrar nos Meus Projetos'
                      }</span>`
                }
              </button>
            </form>
          </div>
        </div>
      </div>
    `;

    const captureDrafts = () => {
      const nEl = this.root.querySelector<HTMLInputElement>('#auth-name');
      const eEl = this.root.querySelector<HTMLInputElement>('#auth-email');
      const pEl = this.root.querySelector<HTMLInputElement>('#auth-password');
      if (nEl) this.draftName = nEl.value;
      if (eEl) this.draftEmail = eEl.value;
      if (pEl) this.draftPassword = pEl.value;
    };

    this.root.querySelectorAll<HTMLButtonElement>('[data-auth-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        captureDrafts();
        const next = btn.dataset.authTab === 'signin' ? 'signin' : 'signup';
        if (next !== this.authMode) {
          this.authMode = next;
          this.authError = '';
          this.renderAuthScreen();
        }
      });
    });

    this.root.querySelector('#btn-toggle-pwd')?.addEventListener('click', () => {
      captureDrafts();
      this.showPassword = !this.showPassword;
      this.renderAuthScreen();
    });

    const avatarInput = this.root.querySelector<HTMLInputElement>('#input-auth-avatar');
    const pickAvatarBtn = this.root.querySelector<HTMLButtonElement>('#btn-pick-avatar');
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
          showToast(err instanceof Error ? err.message : 'Falha ao carregar foto.');
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
        this.isLoading = false;
        await this.mount(acc);
      } catch (err) {
        this.isLoading = false;
        this.authError = err instanceof Error ? err.message : 'Falha na autenticação.';
        this.renderAuthScreen();
      }
    });
  }

  // ==========================================================================
  // 2. MANDATORY STARTUP PROJECTS SCREEN
  //    Strictly ONLY Projects & Create Project + Top-Right Account Photo/Name
  // ==========================================================================
  private renderProjectsScreen(): void {
    const acc = this.account;
    if (!acc) {
      this.renderAuthScreen();
      return;
    }

    const fallbackAvatar = buildMonogramAvatarDataUrl(acc.name, acc.email);

    this.root.innerHTML = `
      <div class="modix-projects-screen">
        <header class="modix-projects-topbar">
          <div class="modix-projects-brand">
            <img src="./brand/modix-mark-white.png" alt="Modix" class="modix-projects-logo" />
            <span class="modix-projects-brand-name">Modix</span>
            <span class="modix-projects-brand-sep"></span>
            <span class="modix-projects-brand-sub">Projetos</span>
            ${
              !this.isLoading
                ? `<span class="modix-projects-count-pill">${this.projects.length}</span>`
                : ''
            }
          </div>

          <div class="modix-projects-topbar-right">
            <input type="file" id="hub-avatar-file" accept="image/*" style="display:none;" />
            <input type="file" id="hub-import-modix" accept=".modix,.json" style="display:none;" />

            <button
              type="button"
              class="modix-account-chip"
              id="btn-account-menu"
              title="Conta conectada: ${escapeHtml(acc.email)}"
            >
              <img
                src="${escapeHtml(acc.avatarUrl || fallbackAvatar)}"
                data-fallback="${escapeHtml(fallbackAvatar)}"
                alt="${escapeHtml(acc.name)}"
                class="modix-account-avatar"
                id="hub-account-avatar-img"
              />
              <div class="modix-account-meta">
                <span class="modix-account-name">${escapeHtml(acc.name)}</span>
                <span class="modix-account-email">${escapeHtml(acc.email)}</span>
              </div>
              <span class="modix-account-caret">${Icons.chevronDown}</span>
            </button>
          </div>
        </header>

        <main class="modix-projects-main">
          <div class="modix-projects-hero">
            <div>
              <h1 class="modix-projects-heading">Meus Projetos</h1>
              <p class="modix-projects-count">
                ${
                  this.isLoading
                    ? 'Sincronizando seus projetos...'
                    : this.projects.length === 0
                      ? 'Nenhum projeto salvo ainda — toque em Criar Projeto para começar.'
                      : `${this.projects.length} projeto${this.projects.length > 1 ? 's' : ''} na sua conta`
                }
              </p>
            </div>

            <button type="button" class="modix-create-project-btn" id="btn-create-project-top">
              ${Icons.plus}<span>Criar Projeto</span>
            </button>
          </div>

          <div class="modix-projects-grid">
            <button
              type="button"
              class="modix-project-card modix-project-create-card"
              id="btn-create-project-card"
            >
              <div class="modix-project-create-plus">${Icons.plus}</div>
              <div class="modix-project-create-label">Criar Projeto</div>
              <div class="modix-project-create-hint">Cena 3D nova ou arquivo .MODIX</div>
            </button>

            ${
              this.isLoading
                ? `<div class="modix-project-card modix-project-skeleton">
                    <div class="modix-btn-spinner"></div>
                    <span>Carregando projetos...</span>
                   </div>`
                : this.projects.map((p) => this.renderProjectCardHtml(p)).join('')
            }
          </div>
        </main>
      </div>
    `;

    // Safe fallback if remote Gravatar fails to load
    const avatarImg = this.root.querySelector<HTMLImageElement>('#hub-account-avatar-img');
    avatarImg?.addEventListener('error', () => {
      const fb = avatarImg.dataset.fallback;
      if (fb && avatarImg.src !== fb) {
        avatarImg.src = fb;
      }
    });

    const accountBtn = this.root.querySelector<HTMLButtonElement>('#btn-account-menu');
    const avatarInput = this.root.querySelector<HTMLInputElement>('#hub-avatar-file');
    const importModixInput = this.root.querySelector<HTMLInputElement>('#hub-import-modix');

    avatarInput?.addEventListener('change', async () => {
      const f = avatarInput.files?.[0];
      avatarInput.value = '';
      if (!f || !this.account) return;
      try {
        const dataUrl = await fileToAvatarDataUrl(f);
        this.account = await updateAccountProfile(this.account, { avatarUrl: dataUrl });
        this.renderProjectsScreen();
        showToast('Foto do perfil atualizada.');
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Falha ao atualizar foto.');
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
          throw new Error('Arquivo de projeto inválido.');
        }
        const baseName = f.name.replace(/\.(modix|json)$/i, '') || 'Projeto Importado';
        const created = await createUserProject(this.account.id, baseName, parsed);
        this.callbacks.onOpenProject(created, this.account);
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Falha ao importar projeto.');
      }
    });

    accountBtn?.addEventListener('click', () => {
      if (!this.account) return;
      openDropdownMenu(accountBtn, [
        { sectionTitle: `${this.account.name} · ${this.account.email}` },
        {
          label: 'Alterar Foto do Perfil...',
          icon: Icons.cameraPhoto,
          onClick: () => avatarInput?.click()
        },
        {
          label: 'Editar Nome...',
          icon: Icons.edit,
          onClick: () => {
            if (!this.account) return;
            openTextPromptModal({
              title: 'Editar Nome da Conta',
              label: 'Seu nome de exibição:',
              initialValue: this.account.name,
              confirmLabel: 'Salvar',
              onConfirm: async (newName) => {
                if (!this.account) return;
                this.account = await updateAccountProfile(this.account, { name: newName });
                this.renderProjectsScreen();
                showToast('Nome atualizado.');
              }
            });
          }
        },
        { divider: true },
        {
          label: 'Sair da Conta',
          icon: Icons.logout,
          onClick: async () => {
            await signOutAccount();
            this.account = null;
            this.projects = [];
            this.authMode = 'signin';
            this.renderAuthScreen();
            showToast('Você saiu da conta.');
          }
        },
        {
          label: 'Deletar Conta...',
          icon: Icons.userDelete,
          danger: true,
          onClick: () => this.openDeleteAccountConfirmModal()
        }
      ]);
    });

    const triggerCreateProject = () => {
      if (!this.account) return;
      const nextIndex = this.projects.length + 1;
      openTextPromptModal({
        title: 'Criar Novo Projeto 3D',
        label: 'Nome do projeto:',
        initialValue: `Projeto ${nextIndex}`,
        placeholder: 'Ex: Personagem, Carro, Espada, Cenário...',
        confirmLabel: 'Criar e Abrir',
        extraActionLabel: 'Importar .MODIX',
        onExtraAction: () => importModixInput?.click(),
        onConfirm: async (projectName) => {
          if (!this.account) return;
          const created = await createUserProject(this.account.id, projectName);
          this.projects.unshift(created);
          this.callbacks.onOpenProject(created, this.account);
        }
      });
    };

    this.root.querySelector('#btn-create-project-top')?.addEventListener('click', triggerCreateProject);
    this.root.querySelector('#btn-create-project-card')?.addEventListener('click', triggerCreateProject);

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
            label: 'Abrir Projeto',
            icon: Icons.folderOpen,
            onClick: () => {
              if (this.account) this.callbacks.onOpenProject(proj, this.account);
            }
          },
          {
            label: 'Renomear Projeto...',
            icon: Icons.edit,
            onClick: () => {
              openTextPromptModal({
                title: 'Renomear Projeto',
                label: 'Novo nome:',
                initialValue: proj.name,
                confirmLabel: 'Salvar',
                onConfirm: async (newName) => {
                  if (!this.account) return;
                  await renameUserProject(proj.id, this.account.id, newName);
                  proj.name = newName;
                  proj.projectData.sceneName = newName;
                  this.renderProjectsScreen();
                  showToast('Projeto renomeado.');
                }
              });
            }
          },
          {
            label: 'Duplicar Projeto',
            icon: Icons.copy,
            onClick: async () => {
              if (!this.account) return;
              const copyState = JSON.parse(JSON.stringify(proj.projectData)) as ModixProjectState;
              const dup = await createUserProject(
                this.account.id,
                `${proj.name} (Cópia)`,
                copyState,
                proj.thumbnailUrl
              );
              this.projects.unshift(dup);
              this.renderProjectsScreen();
              showToast('Projeto duplicado.');
            }
          },
          { divider: true },
          {
            label: 'Excluir Projeto',
            icon: Icons.trash,
            danger: true,
            onClick: async () => {
              if (!this.account) return;
              await deleteUserProject(proj.id, this.account.id);
              this.projects = this.projects.filter((x) => x.id !== proj.id);
              this.renderProjectsScreen();
              showToast('Projeto excluído.');
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

  private renderProjectCardHtml(proj: ModixSavedProject): string {
    const formattedDate = formatShortDate(proj.updatedAt);
    return `
      <div class="modix-project-card" data-project-id="${escapeHtml(proj.id)}">
        <div class="modix-project-thumb">
          ${
            proj.thumbnailUrl
              ? `<img src="${proj.thumbnailUrl}" alt="${escapeHtml(proj.name)}" />`
              : `<div class="modix-project-thumb-placeholder">
                  <div class="modix-project-thumb-grid"></div>
                  ${Icons.file3d}
                 </div>`
          }
          <span class="modix-project-obj-badge">${proj.objectCount} obj</span>
        </div>
        <div class="modix-project-body">
          <div class="modix-project-meta">
            <div class="modix-project-title" title="${escapeHtml(proj.name)}">${escapeHtml(proj.name)}</div>
            <div class="modix-project-sub">${formattedDate}</div>
          </div>
          <div class="modix-project-actions">
            <button type="button" class="modix-project-act-btn" data-proj-more title="Opções do Projeto">
              ${Icons.moreDots}
            </button>
          </div>
        </div>
      </div>
    `;
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
            ${Icons.userDelete}<span>Deletar Conta Permanentemente</span>
          </span>
          <button type="button" class="modix-modal-close" data-close>${Icons.close}</button>
        </div>
        <div class="modix-prompt-body">
          <p style="margin:0;font-size:12px;color:#d4d4d8;line-height:1.5;">
            Tem certeza que deseja excluir permanentemente a conta
            <strong style="color:#ffffff;">${escapeHtml(acc.email)}</strong>
            e todos os seus projetos 3D salvos? Esta ação não pode ser desfeita.
          </p>
        </div>
        <div class="modix-prompt-footer">
          <button type="button" class="modix-btn-sm" data-close>Cancelar</button>
          <button type="button" class="modix-btn-sm danger" id="btn-confirm-del-acc">
            ${Icons.trash}<span>Deletar Conta</span>
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
      confirmBtn.innerHTML = `<span class="modix-btn-spinner"></span><span>Excluindo...</span>`;
      try {
        await deleteAccountPermanently(acc.id);
        close();
        this.account = null;
        this.projects = [];
        this.authMode = 'signup';
        this.renderAuthScreen();
        showToast('Sua conta e seus projetos foram excluídos.');
      } catch (err) {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = `${Icons.trash}<span>Deletar Conta</span>`;
        showToast(err instanceof Error ? err.message : 'Falha ao excluir conta.');
      }
    });
  }
}

function formatShortDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
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
