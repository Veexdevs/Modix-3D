import { Icons } from '../icons/blenderIcons';
import {
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
  private pendingAvatarDataUrl = '';
  private projects: ModixSavedProject[] = [];
  private isLoading = false;
  private authError = '';

  constructor(root: HTMLElement, initialAccount: ModixUserAccount | null, callbacks: ProjectsHubCallbacks) {
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
  // 1. ACCOUNT CREATION / LOGIN SCREEN (Email Required)
  // ==========================================================================
  private renderAuthScreen(): void {
    const isSignUp = this.authMode === 'signup';

    this.root.innerHTML = `
      <div class="modix-auth-screen">
        <div class="modix-auth-shell">
          <div class="modix-auth-brand">
            <img src="./modix-icon.png" alt="Modix 3D" class="modix-auth-logo" />
            <h1 class="modix-auth-title">Modix 3D</h1>
            <p class="modix-auth-subtitle">
              ${
                isSignUp
                  ? 'Crie sua conta com e-mail para criar e gerenciar seus projetos 3D.'
                  : 'Entre com seu e-mail para acessar seus projetos 3D.'
              }
            </p>
          </div>

          <form class="modix-auth-card" id="modix-auth-form" novalidate>
            <div class="modix-auth-tabs">
              <button type="button" class="modix-auth-tab ${isSignUp ? 'active' : ''}" data-auth-tab="signup">
                Criar Conta
              </button>
              <button type="button" class="modix-auth-tab ${!isSignUp ? 'active' : ''}" data-auth-tab="signin">
                Entrar
              </button>
            </div>

            ${
              this.authError
                ? `<div class="modix-auth-error">${Icons.alert}<span>${escapeHtml(this.authError)}</span></div>`
                : ''
            }

            ${
              isSignUp
                ? `
              <div class="modix-auth-avatar-row">
                <div class="modix-auth-avatar-preview" id="auth-avatar-preview">
                  ${
                    this.pendingAvatarDataUrl
                      ? `<img src="${this.pendingAvatarDataUrl}" alt="Foto" />`
                      : Icons.user
                  }
                </div>
                <div style="flex:1;min-width:0;">
                  <div style="font-size:11px;color:#d6d6d6;font-weight:600;">Foto do Perfil / E-mail</div>
                  <div style="font-size:10px;color:#8a8a8a;">Automática pelo e-mail ou envie uma foto</div>
                </div>
                <button type="button" class="modix-btn" id="btn-pick-avatar">
                  ${Icons.cameraPhoto}<span>Foto</span>
                </button>
                <input type="file" id="input-auth-avatar" accept="image/*" style="display:none;" />
              </div>

              <label class="modix-auth-field">
                <span class="modix-auth-label">${Icons.user}<span>Nome</span></span>
                <input type="text" id="auth-name" class="modix-auth-input" placeholder="Seu nome" autocomplete="name" required />
              </label>
            `
                : ''
            }

            <label class="modix-auth-field">
              <span class="modix-auth-label">${Icons.mail}<span>E-mail</span></span>
              <input type="email" id="auth-email" class="modix-auth-input" placeholder="seuemail@exemplo.com" autocomplete="email" required />
            </label>

            <label class="modix-auth-field">
              <span class="modix-auth-label">${Icons.lock}<span>Senha</span></span>
              <input type="password" id="auth-password" class="modix-auth-input" placeholder="Mínimo de 6 caracteres" autocomplete="${
                isSignUp ? 'new-password' : 'current-password'
              }" required />
            </label>

            <button type="submit" class="modix-auth-submit" id="btn-auth-submit" ${
              this.isLoading ? 'disabled' : ''
            }>
              ${
                this.isLoading
                  ? 'Autenticando...'
                  : isSignUp
                    ? 'Criar Conta com E-mail'
                    : 'Entrar na Conta'
              }
            </button>
          </form>
        </div>
      </div>
    `;

    this.root.querySelectorAll<HTMLButtonElement>('[data-auth-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = btn.dataset.authTab === 'signin' ? 'signin' : 'signup';
        if (next !== this.authMode) {
          this.authMode = next;
          this.authError = '';
          this.renderAuthScreen();
        }
      });
    });

    const avatarInput = this.root.querySelector<HTMLInputElement>('#input-auth-avatar');
    const pickAvatarBtn = this.root.querySelector<HTMLButtonElement>('#btn-pick-avatar');
    if (pickAvatarBtn && avatarInput) {
      pickAvatarBtn.addEventListener('click', () => avatarInput.click());
      avatarInput.addEventListener('change', async () => {
        const file = avatarInput.files?.[0];
        if (!file) return;
        try {
          this.pendingAvatarDataUrl = await fileToAvatarDataUrl(file);
          const prev = this.root.querySelector<HTMLElement>('#auth-avatar-preview');
          if (prev) prev.innerHTML = `<img src="${this.pendingAvatarDataUrl}" alt="Foto" />`;
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Falha ao carregar foto.');
        }
      });
    }

    const form = this.root.querySelector<HTMLFormElement>('#modix-auth-form');
    form?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (this.isLoading) return;

      const email = (this.root.querySelector<HTMLInputElement>('#auth-email')?.value || '').trim();
      const password = this.root.querySelector<HTMLInputElement>('#auth-password')?.value || '';
      const name = (this.root.querySelector<HTMLInputElement>('#auth-name')?.value || '').trim();

      this.authError = '';
      this.isLoading = true;
      const submitBtn = this.root.querySelector<HTMLButtonElement>('#btn-auth-submit');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Autenticando...';
      }

      try {
        const acc =
          this.authMode === 'signup'
            ? await signUpWithEmail(email, password, name, this.pendingAvatarDataUrl || undefined)
            : await signInWithEmail(email, password);
        this.account = acc;
        this.pendingAvatarDataUrl = '';
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
  // 2. MANDATORY PROJECTS SCREEN (ONLY Projects & Create Project + Top-Right Profile)
  // ==========================================================================
  private renderProjectsScreen(): void {
    const acc = this.account;
    if (!acc) {
      this.renderAuthScreen();
      return;
    }

    this.root.innerHTML = `
      <div class="modix-projects-screen">
        <header class="modix-projects-header">
          <div class="modix-projects-brand">
            <img src="./modix-icon.png" alt="Modix" class="modix-projects-logo" />
            <span class="modix-projects-heading">Projetos</span>
          </div>

          <div class="modix-projects-header-right">
            <input type="file" id="hub-avatar-file" accept="image/*" style="display:none;" />
            <input type="file" id="hub-import-modix" accept=".modix,.json" style="display:none;" />
            <button type="button" class="modix-account-pill" id="btn-account-menu" title="${escapeHtml(acc.email)}">
              <img src="${escapeHtml(acc.avatarUrl)}" alt="${escapeHtml(acc.name)}" class="modix-account-avatar" />
              <div class="modix-account-meta">
                <span class="modix-account-name">${escapeHtml(acc.name)}</span>
                <span class="modix-account-email">${escapeHtml(acc.email)}</span>
              </div>
              <span class="modix-account-caret">${Icons.chevronDown}</span>
            </button>
          </div>
        </header>

        <main class="modix-projects-body">
          <div class="modix-projects-grid">
            <button type="button" class="modix-project-card modix-create-card" id="btn-create-project">
              <div class="modix-create-icon">${Icons.plus}</div>
              <div class="modix-create-title">Criar Projeto</div>
            </button>

            ${
              this.isLoading
                ? `<div class="modix-projects-status">Carregando projetos...</div>`
                : this.projects.map((p) => this.renderProjectCardHtml(p)).join('')
            }
          </div>
        </main>
      </div>
    `;

    // Account menu in top-right corner (Photo + Name + Sign Out + Delete Account)
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
        { sectionTitle: `${this.account.name} (${this.account.email})` },
        {
          label: 'Alterar Foto do Perfil...',
          icon: Icons.cameraPhoto,
          onClick: () => avatarInput?.click()
        },
        {
          label: 'Alterar Nome...',
          icon: Icons.edit,
          onClick: () => {
            if (!this.account) return;
            openTextPromptModal({
              title: 'Alterar Nome da Conta',
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
        { divider: true, label: '' },
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
          label: 'Deletar Conta Permanentemente...',
          icon: Icons.userDelete,
          danger: true,
          onClick: () => this.openDeleteAccountConfirmModal()
        }
      ]);
    });

    // Create Project button
    const createBtn = this.root.querySelector<HTMLButtonElement>('#btn-create-project');
    createBtn?.addEventListener('click', () => {
      if (!this.account) return;
      const nextIndex = this.projects.length + 1;
      openTextPromptModal({
        title: 'Criar Novo Projeto',
        label: 'Nome do projeto:',
        initialValue: `Projeto ${nextIndex}`,
        placeholder: 'Ex: Cenário, Personagem, Arma...',
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
    });

    // Existing project cards
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
          { divider: true, label: '' },
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
              : `<div class="modix-project-placeholder">${Icons.file3d}</div>`
          }
        </div>
        <div class="modix-project-footer">
          <div class="modix-project-info">
            <div class="modix-project-name" title="${escapeHtml(proj.name)}">${escapeHtml(proj.name)}</div>
            <div class="modix-project-meta">${formattedDate} · ${proj.objectCount} obj</div>
          </div>
          <button type="button" class="modix-project-more" data-proj-more title="Opções do Projeto">
            ${Icons.moreDots}
          </button>
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
      <div class="modix-modal" style="width:min(400px, 92vw);">
        <div class="modix-modal-hdr">
          <span style="display:flex;align-items:center;gap:6px;color:#fca5a5;">
            ${Icons.userDelete}<span>Deletar Conta</span>
          </span>
          <button type="button" class="modix-btn" data-close style="height:22px;padding:0 6px;">${Icons.close}</button>
        </div>
        <div class="modix-modal-body" style="gap:10px;">
          <div style="font-size:11.5px;color:#dcdcdc;line-height:1.45;">
            Tem certeza que deseja excluir permanentemente a conta <strong>${escapeHtml(acc.email)}</strong> e todos os seus projetos salvos? Esta ação não pode ser desfeita.
          </div>
          <div style="display:flex;justify-content:flex-end;gap:8px;">
            <button type="button" class="modix-btn" data-close>Cancelar</button>
            <button type="button" class="modix-btn danger" id="btn-confirm-del-acc">
              ${Icons.trash}<span>Deletar Minha Conta</span>
            </button>
          </div>
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
      confirmBtn.textContent = 'Excluindo...';
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
