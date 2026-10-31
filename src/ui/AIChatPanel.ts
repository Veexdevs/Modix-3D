import {
  askModixIA,
  hasCustomOpenRouterKey,
  isMultiAIEnabled,
  prepareReferenceImage,
  runModixMultiAgent,
  setCustomOpenRouterKey,
  setMultiAIEnabled,
  type ChatHistoryItem,
  type ChatRoleMode,
  type ReferenceImageAttachment
} from '../ai/OpenRouterAgent';
import type { ModixEngine } from '../engine/ModixEngine';
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

  constructor(engine: ModixEngine, showToast: (msg: string) => void) {
    this.engine = engine;
    this.showToast = showToast;
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
    if (this.panelEl) {
      this.panelEl.remove();
      this.panelEl = null;
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
      this.showToast(`Limite máximo de ${MAX_REFERENCE_IMAGES} imagens por envio.`);
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
          err instanceof Error ? err.message : 'Não foi possível processar a imagem.'
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
    const hasPendingRefs = this.pendingRefs.length > 0;
    const isAgent = this.mode === 'agente';

    this.panelEl.innerHTML = `
      <!-- Compact Clean Header -->
      <div class="modix-ai-hdr">
        <div class="modix-ai-seg" role="tablist" aria-label="Modo do Chat">
          <button
            type="button"
            class="modix-ai-seg-btn ${!isAgent ? 'active' : ''}"
            data-mode="ia"
            title="Modo IA: responde dúvidas e analisa imagens sem alterar a cena"
          >
            ${Icons.chat}<span>IA</span>
          </button>
          <button
            type="button"
            class="modix-ai-seg-btn ${isAgent ? 'active' : ''}"
            data-mode="agente"
            title="Modo Agente: modela, esculpe, pinta e replica referências em 3D"
          >
            ${Icons.bolt}<span>Agente</span>
          </button>
        </div>

        <div class="modix-ai-hdr-actions">
          ${
            isAgent
              ? `<button type="button" class="modix-ai-icon-btn" id="ai-quick-undo" title="Desfazer última ação 3D">
                  ${Icons.undo}
                 </button>`
              : ''
          }
          <button
            type="button"
            class="modix-ai-icon-btn ${this.showSettings ? 'active' : ''}"
            id="ai-btn-settings"
            title="Configurações"
          >
            ${Icons.settings}
          </button>
          ${
            this.history.length > 0
              ? `<button type="button" class="modix-ai-icon-btn" id="ai-btn-clear" title="Limpar conversa">
                  ${Icons.trash}
                 </button>`
              : ''
          }
          <button type="button" class="modix-ai-icon-btn" id="ai-btn-close" title="Fechar">
            ${Icons.close}
          </button>
        </div>
      </div>

      ${
        this.showSettings
          ? `<div class="modix-ai-settings">
              <label class="modix-ai-chk">
                <input type="checkbox" id="ai-chk-multi" ${multiOn ? 'checked' : ''} />
                <span>Pipeline Multi-IA (Visão + Modelagem + Inspeção 3D)</span>
              </label>
              <div class="modix-ai-settings-lbl">
                Chave OpenRouter ${customKey ? '(personalizada)' : '(padrão ativa)'}
              </div>
              <div class="modix-ai-settings-row">
                <input
                  type="password"
                  id="ai-key-input"
                  class="modix-ai-key-inp"
                  placeholder="sk-or-v1-..."
                />
                <button type="button" class="modix-btn-sm" id="ai-key-save">Salvar</button>
                ${
                  customKey
                    ? `<button type="button" class="modix-btn-sm" id="ai-key-reset">Padrão</button>`
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
                <div class="modix-ai-empty-title">${isAgent ? 'Agente 3D' : 'Assistente IA'}</div>
                <div class="modix-ai-empty-sub">
                  ${
                    isAgent
                      ? 'Peça qualquer modelo 3D ou anexe fotos de referência para réplica fiel.'
                      : 'Tire dúvidas sobre modelagem, topologia, texturas ou exportação 3D.'
                  }
                </div>
               </div>`
            : this.history
                .map(
                  (m) => `
                <div class="modix-ai-msg ${m.role}">
                  <div class="modix-ai-msg-meta">
                    ${
                      m.role === 'user'
                        ? 'Você'
                        : m.mode === 'agente'
                          ? 'Agente'
                          : 'IA'
                    }
                  </div>
                  ${
                    m.images && m.images.length > 0
                      ? `<div class="modix-ai-msg-refs">
                          ${m.images
                            .map(
                              (img, idx) => `
                            <div class="modix-ai-msg-ref-thumb" title="${escapeHtml(img.name)}">
                              <img src="${img.dataUrl}" alt="Ref ${idx + 1}" />
                              <span class="ref-idx">#${idx + 1}</span>
                            </div>`
                            )
                            .join('')}
                         </div>`
                      : ''
                  }
                  <div class="modix-ai-msg-text">${formatSimpleMarkdown(m.content)}</div>
                  ${
                    m.agentSteps && m.agentSteps.length > 0
                      ? `<details class="modix-ai-steps-details">
                          <summary>${Icons.check}<span>${m.agentSteps.length} etapa${m.agentSteps.length > 1 ? 's' : ''} executada${m.agentSteps.length > 1 ? 's' : ''}</span></summary>
                          <div class="modix-ai-steps">
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
                  <div class="live-badge">${escapeHtml(liveBadge || (isAgent ? 'Agente 3D' : 'IA'))}</div>
                  <div class="live-desc">${escapeHtml(liveStep || 'Processando...')}</div>
                </div>
               </div>`
            : ''
        }
      </div>

      ${
        hasPendingRefs
          ? `<div class="modix-ai-ref-strip">
              <div class="modix-ai-ref-hdr">
                <span>Referências (${this.pendingRefs.length}/${MAX_REFERENCE_IMAGES})</span>
                ${
                  !this.busy
                    ? `<button type="button" class="modix-ai-ref-clear" id="ai-clear-refs">Limpar</button>`
                    : ''
                }
              </div>
              <div class="modix-ai-ref-list">
                ${this.pendingRefs
                  .map(
                    (ref, idx) => `
                  <div class="modix-ai-ref-item" title="${escapeHtml(ref.name)}">
                    <img src="${ref.dataUrl}" alt="${escapeHtml(ref.name)}" />
                    <span class="modix-ai-ref-badge">#${idx + 1}</span>
                    ${
                      !this.busy
                        ? `<button type="button" class="modix-ai-ref-rm" data-rm-ref="${escapeHtml(ref.id)}" title="Remover">${Icons.close}</button>`
                        : ''
                    }
                  </div>`
                  )
                  .join('')}
                ${
                  !this.busy && this.pendingRefs.length < MAX_REFERENCE_IMAGES
                    ? `<button type="button" class="modix-ai-ref-add-more" id="ai-btn-add-more-ref" title="Adicionar outra referência">
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
          title="Anexar imagens de referência"
          ${this.busy ? 'disabled' : ''}
        >
          ${Icons.imagePlus}
          ${hasPendingRefs ? `<span class="attach-count">${this.pendingRefs.length}</span>` : ''}
        </button>

        <input
          type="text"
          id="ai-chat-input"
          value="${escapeHtml(this.draftText)}"
          placeholder="${
            hasPendingRefs
              ? 'Detalhes opcionais ou envie direto...'
              : isAgent
                ? 'Descreva o modelo 3D...'
                : 'Pergunte algo...'
          }"
          autocomplete="off"
          ${this.busy ? 'disabled' : ''}
        />

        <button type="submit" class="modix-ai-send-btn" ${this.busy ? 'disabled' : ''} title="Enviar">
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
    });

    this.panelEl.querySelector('#ai-quick-undo')?.addEventListener('click', () => {
      const ok = this.engine.undo();
      this.showToast(ok ? 'Última ação 3D desfeita' : 'Nada para desfazer');
    });

    this.panelEl.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (this.busy) return;
        this.mode = (btn.dataset.mode as ChatRoleMode) || 'agente';
        this.render();
      });
    });

    this.panelEl.querySelector<HTMLInputElement>('#ai-chk-multi')?.addEventListener('change', (e) => {
      setMultiAIEnabled((e.target as HTMLInputElement).checked);
      this.render();
    });

    this.panelEl.querySelector('#ai-key-save')?.addEventListener('click', () => {
      const keyInp = this.panelEl?.querySelector<HTMLInputElement>('#ai-key-input');
      if (keyInp && keyInp.value.trim()) {
        setCustomOpenRouterKey(keyInp.value.trim());
        this.showToast('Chave personalizada OpenRouter salva.');
        this.showSettings = false;
        this.render();
      }
    });

    this.panelEl.querySelector('#ai-key-reset')?.addEventListener('click', () => {
      setCustomOpenRouterKey('');
      this.showToast('Restaurada chave OpenRouter padrão');
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
        ? `Replicar fielmente em 3D (${attachedRefs.length} imagem${attachedRefs.length > 1 ? 'ns' : ''} de referência)`
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
      activeMode === 'agente'
        ? attachedRefs.length > 0
          ? 'Analisando Referências'
          : 'Agente 3D'
        : 'IA',
      attachedRefs.length > 0
        ? `Lendo ${attachedRefs.length} imagem(ns) de referência...`
        : 'Conectando...'
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
        this.showToast('Cena 3D atualizada pelo Agente.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attachedRefs.length > 0 && this.pendingRefs.length === 0) {
        this.pendingRefs = attachedRefs;
      }
      this.history.push({
        role: 'assistant',
        mode: activeMode,
        content: `**Erro**: ${msg}`
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
