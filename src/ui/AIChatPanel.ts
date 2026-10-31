import {
  askModixIA,
  fetchUnlockedOpenRouterCatalog,
  getPreferredOpenRouterModel,
  hasCustomOpenRouterKey,
  isMultiAIEnabled,
  prepareReferenceImage,
  runModixMultiAgent,
  setCustomOpenRouterKey,
  setMultiAIEnabled,
  setPreferredOpenRouterModel,
  UNLOCKED_FRONTIER_MODELS,
  type ChatHistoryItem,
  type ChatRoleMode,
  type ReferenceImageAttachment,
  type UnlockedAIModelOption
} from '../ai/OpenRouterAgent';
import type { ModixEngine } from '../engine/ModixEngine';
import { onLanguageChange, tr } from '../i18n/I18nService';
import { Icons } from '../icons/blenderIcons';

const MAX_REFERENCE_IMAGES = 8;

export class AIChatPanel {
  private engine: ModixEngine;
  private showToast: (msg: string) => void;
  private panelEl: HTMLElement | null = null;
  private isOpen = false;
  private mode: ChatRoleMode = 'agente';
  private busy = false;
  private showSettings = false;
  private draftText = '';
  private pendingRefs: ReferenceImageAttachment[] = [];
  private history: ChatHistoryItem[] = [];
  private availableModels: UnlockedAIModelOption[] = [...UNLOCKED_FRONTIER_MODELS];
  private unsubLang: (() => void) | null = null;

  constructor(engine: ModixEngine, showToast: (msg: string) => void) {
    this.engine = engine;
    this.showToast = showToast;
    this.unsubLang = onLanguageChange(() => {
      if (this.isOpen) this.render();
    });
  }

  public toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  public open(initialMode?: ChatRoleMode): void {
    if (initialMode) this.mode = initialMode;
    this.isOpen = true;
    this.syncTopbarButton();
    this.ensureMounted();
    this.render();
    void this.refreshModelCatalog();
  }

  public close(): void {
    this.isOpen = false;
    this.syncTopbarButton();
    if (this.panelEl) {
      this.panelEl.style.display = 'none';
    }
  }

  public destroy(): void {
    this.isOpen = false;
    this.syncTopbarButton();
    this.unsubLang?.();
    this.unsubLang = null;
    if (this.panelEl) {
      this.panelEl.remove();
      this.panelEl = null;
    }
  }

  private async refreshModelCatalog(): Promise<void> {
    try {
      const list = await fetchUnlockedOpenRouterCatalog();
      if (list.length > this.availableModels.length) {
        this.availableModels = list;
        if (this.isOpen && this.showSettings) {
          this.render();
        }
      }
    } catch {
      // Keep curated frontier list
    }
  }

  private syncTopbarButton(): void {
    document.getElementById('btn-open-ai')?.classList.toggle('active', this.isOpen);
  }

  private ensureMounted(): void {
    if (this.panelEl && document.body.contains(this.panelEl)) {
      this.panelEl.style.display = 'flex';
      return;
    }
    this.panelEl = document.createElement('aside');
    this.panelEl.className = 'modix-ai-drawer';
    this.bindDropAndPaste(this.panelEl);
    document.body.appendChild(this.panelEl);
  }

  private bindDropAndPaste(el: HTMLElement): void {
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      el.classList.add('drag-over');
    });
    el.addEventListener('dragleave', () => {
      el.classList.remove('drag-over');
    });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drag-over');
      if (this.busy) return;
      const files = Array.from(e.dataTransfer?.files || []).filter((f) =>
        f.type.startsWith('image/')
      );
      if (files.length > 0) {
        void this.addReferenceFiles(files);
      }
    });
    el.addEventListener('paste', (e) => {
      if (this.busy) return;
      const items = Array.from(e.clipboardData?.items || []);
      const files: File[] = [];
      for (const it of items) {
        if (it.type.startsWith('image/')) {
          const f = it.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        void this.addReferenceFiles(files);
      }
    });
  }

  private async addReferenceFiles(files: File[]): Promise<void> {
    const remaining = MAX_REFERENCE_IMAGES - this.pendingRefs.length;
    if (remaining <= 0) {
      this.showToast(`Max ${MAX_REFERENCE_IMAGES}`);
      return;
    }

    const slice = files.slice(0, remaining);
    let added = 0;
    for (const file of slice) {
      try {
        const prepared = await prepareReferenceImage(file);
        this.pendingRefs.push(prepared);
        added++;
      } catch (err) {
        this.showToast(
          err instanceof Error ? err.message : tr('Erro')
        );
      }
    }
    if (added > 0) {
      this.render();
    }
  }

  private render(liveBadge?: string, liveStep?: string): void {
    if (!this.panelEl) return;

    const multiOn = isMultiAIEnabled();
    const customKey = hasCustomOpenRouterKey();
    const preferredModel = getPreferredOpenRouterModel();
    const hasPendingRefs = this.pendingRefs.length > 0;
    const isAgent = this.mode === 'agente';

    this.panelEl.innerHTML = `
      <!-- Compact Clean Header -->
      <div class="modix-ai-hdr">
        <div class="modix-ai-seg" role="tablist">
          <button
            type="button"
            class="modix-ai-seg-btn ${!isAgent ? 'active' : ''}"
            data-mode="ia"
            title="${escapeHtml(tr('Modo IA: responde dúvidas e analisa imagens sem alterar a cena'))}"
          >
            ${Icons.chat}<span>${escapeHtml(tr('IA'))}</span>
          </button>
          <button
            type="button"
            class="modix-ai-seg-btn ${isAgent ? 'active' : ''}"
            data-mode="agente"
            title="${escapeHtml(tr('Modo Agente: modela, esculpe, pinta e replica referências em 3D'))}"
          >
            ${Icons.bolt}<span>${escapeHtml(tr('Agente'))}</span>
          </button>
        </div>

        <div class="modix-ai-hdr-actions">
          ${
            isAgent
              ? `<button type="button" class="modix-ai-icon-btn" id="ai-quick-undo" title="${escapeHtml(tr('Desfazer última ação 3D'))}">
                  ${Icons.undo}
                 </button>`
              : ''
          }
          <button
            type="button"
            class="modix-ai-icon-btn ${this.showSettings ? 'active' : ''}"
            id="ai-btn-settings"
            title="${escapeHtml(tr('Configurações'))}"
          >
            ${Icons.settings}
          </button>
          ${
            this.history.length > 0
              ? `<button type="button" class="modix-ai-icon-btn" id="ai-btn-clear" title="${escapeHtml(tr('Limpar conversa'))}">
                  ${Icons.trash}
                 </button>`
              : ''
          }
          <button type="button" class="modix-ai-icon-btn" id="ai-btn-close" title="${escapeHtml(tr('Fechar'))}">
            ${Icons.close}
          </button>
        </div>
      </div>

      ${
        this.showSettings
          ? `<div class="modix-ai-settings">
              <div class="modix-ai-settings-lbl">${escapeHtml(tr('Modelo de IA (OpenRouter)'))}</div>
              <select id="ai-model-select" class="modix-ai-model-select" data-no-i18n="true">
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

              <label class="modix-ai-chk">
                <input type="checkbox" id="ai-chk-multi" ${multiOn ? 'checked' : ''} />
                <span>${escapeHtml(tr('Pipeline Multi-IA (Visão + Modelagem + Inspeção 3D)'))}</span>
              </label>

              <div class="modix-ai-settings-lbl">
                ${escapeHtml(
                  customKey
                    ? tr('Chave personalizada OpenRouter ativa neste dispositivo.')
                    : tr('Chave integrada ativa por padrão. Opcionalmente informe sua própria chave OpenRouter.')
                )}
              </div>
              <div class="modix-ai-settings-row">
                <input
                  type="password"
                  id="ai-key-input"
                  class="modix-ai-key-inp"
                  data-no-i18n="true"
                  placeholder="sk-or-v1-..."
                />
                <button type="button" class="modix-btn-sm" id="ai-key-save">${escapeHtml(tr('Salvar'))}</button>
                ${
                  customKey
                    ? `<button type="button" class="modix-btn-sm" id="ai-key-reset">${escapeHtml(tr('Padrão'))}</button>`
                    : ''
                }
              </div>
            </div>`
          : ''
      }

      <!-- Messages Feed -->
      <div class="modix-ai-messages" id="ai-msg-list">
        ${
          this.history.length === 0 && !this.busy
            ? `<div class="modix-ai-empty">
                <div class="modix-ai-empty-ico">${isAgent ? Icons.bolt : Icons.chat}</div>
                <div class="modix-ai-empty-title">${escapeHtml(tr(isAgent ? 'Agente 3D' : 'Assistente IA'))}</div>
                <div class="modix-ai-empty-sub">
                  ${escapeHtml(
                    tr(
                      isAgent
                        ? 'Peça qualquer modelo 3D ou anexe fotos de referência para réplica fiel.'
                        : 'Tire dúvidas sobre modelagem, topologia, texturas ou exportação 3D.'
                    )
                  )}
                </div>
               </div>`
            : this.history
                .map(
                  (m) => `
                <div class="modix-ai-msg ${m.role}">
                  <div class="modix-ai-msg-meta">
                    ${escapeHtml(
                      tr(
                        m.role === 'user'
                          ? 'Você'
                          : m.mode === 'agente'
                            ? 'Agente'
                            : 'IA'
                      )
                    )}
                  </div>
                  ${
                    m.images && m.images.length > 0
                      ? `<div class="modix-ai-msg-refs">
                          ${m.images
                            .map(
                              (img, idx) => `
                            <div class="modix-ai-msg-ref-thumb" data-no-i18n="true" title="${escapeHtml(img.name)}">
                              <img src="${img.dataUrl}" alt="${escapeHtml(img.name)}" />
                              <span class="ref-idx">#${idx + 1}</span>
                            </div>`
                            )
                            .join('')}
                         </div>`
                      : ''
                  }
                  <div class="modix-ai-msg-text" data-no-i18n="true">${formatSimpleMarkdown(m.content)}</div>
                  ${
                    m.agentSteps && m.agentSteps.length > 0
                      ? `<details class="modix-ai-steps-details">
                          <summary>${Icons.check}<span>${escapeHtml(tr(`${m.agentSteps.length} etapas executadas`))}</span></summary>
                          <div class="modix-ai-steps" data-no-i18n="true">
                            ${m.agentSteps
                              .map(
                                (s) =>
                                  `<div class="modix-ai-step-item">${escapeHtml(s)}</div>`
                              )
                              .join('')}
                          </div>
                         </details>`
                      : ''
                  }
                </div>`
                )
                .join('')
        }

        ${
          this.busy
            ? `<div class="modix-ai-live-status">
                <div class="modix-ai-spinner"></div>
                <div class="modix-ai-live-copy">
                  <div class="live-badge" data-no-i18n="true">${escapeHtml(liveBadge || tr(isAgent ? 'Agente 3D' : 'IA'))}</div>
                  <div class="live-desc">${escapeHtml(liveStep || tr('Processando...'))}</div>
                </div>
               </div>`
            : ''
        }
      </div>

      ${
        hasPendingRefs
          ? `<div class="modix-ai-ref-strip">
              <div class="modix-ai-ref-hdr">
                <span>${escapeHtml(tr(`Referências (${this.pendingRefs.length}/${MAX_REFERENCE_IMAGES})`))}</span>
                ${
                  !this.busy
                    ? `<button type="button" class="modix-ai-ref-clear" id="ai-clear-refs">${escapeHtml(tr('Limpar'))}</button>`
                    : ''
                }
              </div>
              <div class="modix-ai-ref-list">
                ${this.pendingRefs
                  .map(
                    (ref, idx) => `
                  <div class="modix-ai-ref-item" data-no-i18n="true" title="${escapeHtml(ref.name)}">
                    <img src="${ref.dataUrl}" alt="${escapeHtml(ref.name)}" />
                    <span class="modix-ai-ref-badge">#${idx + 1}</span>
                    ${
                      !this.busy
                        ? `<button type="button" class="modix-ai-ref-rm" data-rm-ref="${escapeHtml(ref.id)}" title="${escapeHtml(tr('Remover'))}">${Icons.close}</button>`
                        : ''
                    }
                  </div>`
                  )
                  .join('')}
                ${
                  !this.busy && this.pendingRefs.length < MAX_REFERENCE_IMAGES
                    ? `<button type="button" class="modix-ai-ref-add-more" id="ai-btn-add-more-ref" title="${escapeHtml(tr('Adicionar outra referência'))}">
                        ${Icons.plus}
                       </button>`
                    : ''
                }
              </div>
            </div>`
          : ''
      }

      <input
        type="file"
        id="ai-ref-file-input"
        accept="image/*"
        multiple
        style="display:none;"
      />

      <form class="modix-ai-input-bar" id="ai-chat-form">
        <button
          type="button"
          class="modix-ai-attach-btn ${hasPendingRefs ? 'has-refs' : ''}"
          id="ai-btn-attach-ref"
          title="${escapeHtml(tr('Anexar imagens de referência'))}"
          ${this.busy ? 'disabled' : ''}
        >
          ${Icons.imagePlus}
          ${hasPendingRefs ? `<span class="attach-count">${this.pendingRefs.length}</span>` : ''}
        </button>

        <input
          type="text"
          id="ai-chat-input"
          value="${escapeHtml(this.draftText)}"
          placeholder="${escapeHtml(
            tr(
              hasPendingRefs
                ? 'Detalhes opcionais ou envie direto...'
                : isAgent
                  ? 'Descreva o modelo 3D...'
                  : 'Pergunte algo...'
            )
          )}"
          autocomplete="off"
          ${this.busy ? 'disabled' : ''}
        />

        <button type="submit" class="modix-ai-send-btn" ${this.busy ? 'disabled' : ''} title="${escapeHtml(tr('Enviar'))}">
          ${this.busy ? `<span class="modix-btn-spinner"></span>` : Icons.sendArrow}
        </button>
      </form>
    `;

    const listEl = this.panelEl.querySelector<HTMLElement>('#ai-msg-list');
    if (listEl) listEl.scrollTop = listEl.scrollHeight;

    const refFileInput = this.panelEl.querySelector<HTMLInputElement>('#ai-ref-file-input');
    const openRefPicker = () => {
      if (!this.busy) refFileInput?.click();
    };

    this.panelEl.querySelector('#ai-btn-attach-ref')?.addEventListener('click', openRefPicker);
    this.panelEl.querySelector('#ai-btn-add-more-ref')?.addEventListener('click', openRefPicker);

    refFileInput?.addEventListener('change', () => {
      const files = Array.from(refFileInput.files || []);
      refFileInput.value = '';
      if (files.length > 0) {
        void this.addReferenceFiles(files);
      }
    });

    this.panelEl.querySelector('#ai-clear-refs')?.addEventListener('click', () => {
      if (this.busy) return;
      this.pendingRefs = [];
      this.render();
    });

    this.panelEl.querySelectorAll<HTMLButtonElement>('[data-rm-ref]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (this.busy) return;
        const id = btn.dataset.rmRef;
        this.pendingRefs = this.pendingRefs.filter((r) => r.id !== id);
        this.render();
      });
    });

    this.panelEl.querySelector('#ai-btn-close')?.addEventListener('click', () => this.close());
    this.panelEl.querySelector('#ai-btn-clear')?.addEventListener('click', () => {
      if (this.busy) return;
      this.pendingRefs = [];
      this.draftText = '';
      this.history = [];
      this.render();
    });

    this.panelEl.querySelector('#ai-btn-settings')?.addEventListener('click', () => {
      this.showSettings = !this.showSettings;
      this.render();
      if (this.showSettings) {
        void this.refreshModelCatalog();
      }
    });

    this.panelEl.querySelector('#ai-quick-undo')?.addEventListener('click', () => {
      const ok = this.engine.undo();
      this.showToast(tr(ok ? 'Última ação 3D desfeita' : 'Nada para desfazer'));
    });

    this.panelEl.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (this.busy) return;
        this.mode = (btn.dataset.mode as ChatRoleMode) || 'agente';
        this.render();
      });
    });

    this.panelEl
      .querySelector<HTMLSelectElement>('#ai-model-select')
      ?.addEventListener('change', (e) => {
        const val = (e.target as HTMLSelectElement).value || 'auto';
        setPreferredOpenRouterModel(val);
      });

    this.panelEl.querySelector<HTMLInputElement>('#ai-chk-multi')?.addEventListener('change', (e) => {
      setMultiAIEnabled((e.target as HTMLInputElement).checked);
      this.render();
    });

    this.panelEl.querySelector('#ai-key-save')?.addEventListener('click', () => {
      const keyInp = this.panelEl?.querySelector<HTMLInputElement>('#ai-key-input');
      if (keyInp && keyInp.value.trim()) {
        setCustomOpenRouterKey(keyInp.value.trim());
        this.showToast(tr('Salvar'));
        this.showSettings = false;
        this.render();
      }
    });

    this.panelEl.querySelector('#ai-key-reset')?.addEventListener('click', () => {
      setCustomOpenRouterKey('');
      this.render();
    });

    const form = this.panelEl.querySelector<HTMLFormElement>('#ai-chat-form');
    const inp = this.panelEl.querySelector<HTMLInputElement>('#ai-chat-input');
    inp?.addEventListener('input', () => {
      this.draftText = inp.value;
    });

    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = inp?.value.trim() || '';
      if (val || this.pendingRefs.length > 0) {
        void this.submitPrompt(val);
      }
    });
  }

  private async submitPrompt(prompt: string): Promise<void> {
    if (this.busy) return;
    const activeMode = this.mode;
    const priorHistory = [...this.history];
    const attachedRefs = [...this.pendingRefs];

    const displayPrompt =
      prompt ||
      (attachedRefs.length > 0
        ? `${tr('Referências')} (${attachedRefs.length})`
        : '');
    if (!displayPrompt) return;

    this.pendingRefs = [];
    this.draftText = '';

    this.history.push({
      role: 'user',
      mode: activeMode,
      content: displayPrompt,
      images: attachedRefs.length > 0 ? attachedRefs : undefined
    });

    this.busy = true;
    this.render(
      activeMode === 'agente' ? tr('Agente 3D') : tr('IA'),
      tr('Conectando...')
    );

    try {
      if (activeMode === 'ia') {
        const answer = await askModixIA(prompt, priorHistory, this.engine, attachedRefs);
        this.history.push({
          role: 'assistant',
          mode: 'ia',
          content: answer
        });
      } else {
        const res = await runModixMultiAgent(
          prompt,
          priorHistory,
          this.engine,
          (badge, stepText) => {
            this.render(badge, stepText);
          },
          attachedRefs
        );
        this.history.push({
          role: 'assistant',
          mode: 'agente',
          content: res.reply,
          agentSteps: res.steps
        });
        this.showToast(tr('Cena 3D atualizada pelo Agente.'));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attachedRefs.length > 0 && this.pendingRefs.length === 0) {
        this.pendingRefs = attachedRefs;
      }
      this.history.push({
        role: 'assistant',
        mode: activeMode,
        content: `**Error**: ${msg}`
      });
    } finally {
      this.busy = false;
      this.render();
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
  );
}

function formatSimpleMarkdown(raw: string): string {
  return escapeHtml(raw)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br/>');
}
