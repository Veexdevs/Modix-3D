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

  private history: ChatHistoryItem[] = [
    {
      role: 'assistant',
      mode: 'agente',
      content:
        'Escolha entre **IA** (responde dúvidas e analisa fotos) ou **Agente** (equipe Multi-IA de modelagem 3D Master com Lofting, Curvas 3D, Simetria e Inspeção Visual). Você pode anexar **várias imagens de referência** (frente, lado, costas, detalhes) no botão de imagem abaixo para o Agente construir o modelo idêntico.'
    }
  ];

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
    this.ensureMounted();
    this.render();
  }

  public close(): void {
    this.isOpen = false;
    if (this.panelEl) {
      this.panelEl.style.display = 'none';
    }
  }

  public destroy(): void {
    this.isOpen = false;
    if (this.panelEl) {
      this.panelEl.remove();
      this.panelEl = null;
    }
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
    const slots = MAX_REFERENCE_IMAGES - this.pendingRefs.length;
    if (slots <= 0) {
      this.showToast(`Limite de ${MAX_REFERENCE_IMAGES} imagens de referência por envio.`);
      return;
    }
    const batch = files.slice(0, slots);
    let added = 0;
    for (const file of batch) {
      try {
        const prepared = await prepareReferenceImage(file);
        this.pendingRefs.push(prepared);
        added++;
      } catch (err) {
        this.showToast(err instanceof Error ? err.message : 'Falha ao processar imagem.');
      }
    }
    if (added > 0) {
      this.render();
      this.showToast(`${added} imagem(ns) de referência anexada(s).`);
    }
  }

  private render(liveBadge = '', liveStep = ''): void {
    if (!this.panelEl) return;
    this.panelEl.style.display = this.isOpen ? 'flex' : 'none';
    if (!this.isOpen) return;

    const currentInput = this.panelEl.querySelector<HTMLInputElement>('#ai-chat-input');
    if (currentInput && !this.busy) {
      this.draftText = currentInput.value;
    }

    const multiOn = isMultiAIEnabled();
    const customKey = hasCustomOpenRouterKey();
    const hasPendingRefs = this.pendingRefs.length > 0;

    const quickPrompts =
      this.mode === 'agente'
        ? hasPendingRefs
          ? [
              'Faça o modelo 3D idêntico às imagens de referência em todos os detalhes e cores',
              'Construa fiel às referências usando vistas frontal e lateral com texturas PBR',
              'Modele apenas o objeto principal das imagens com máxima precisão de silhueta'
            ]
          : [
              'Crie uma katana lendária detalhada com lâmina curva, guarda esculpida e bainha',
              'Construa um carro esportivo aerodinâmico completo com rodas, faróis e aerofólio',
              'Crie um personagem guerreiro sci-fi articulado com armadura, visor e capa',
              'Recorte o objeto selecionado ao meio no eixo Z'
            ]
        : [
            'Como exportar modelos .OBJ e .GLB com texturas e normais?',
            'Analise a cena atual e sugira melhorias de topologia'
          ];

    this.panelEl.innerHTML = `
      <div class="modix-ai-header">
        <div class="modix-ai-title">
          <span class="modix-ai-spark">${Icons.sparkles}</span>
          <span>Modix Studio AI</span>
        </div>
        <div style="display:flex;gap:4px;align-items:center;">
          <button type="button" class="modix-ai-icon-btn ${this.showSettings ? 'active' : ''}" id="ai-btn-settings" title="Configurações OpenRouter & Multi-IA">${Icons.settings}</button>
          <button type="button" class="modix-ai-icon-btn" id="ai-btn-clear" title="Limpar conversa">${Icons.trash}</button>
          <button type="button" class="modix-ai-icon-btn" id="ai-btn-close" title="Fechar">${Icons.close}</button>
        </div>
      </div>

      <!-- Mode Switcher: IA vs Agente -->
      <div class="modix-ai-mode-switch">
        <button type="button" class="modix-ai-mode-btn ${this.mode === 'ia' ? 'active ia' : ''}" data-mode="ia">
          ${Icons.chat}
          <span><b>IA</b> · Só Responde</span>
        </button>
        <button type="button" class="modix-ai-mode-btn ${this.mode === 'agente' ? 'active agente' : ''}" data-mode="agente">
          ${Icons.bolt}
          <span><b>Agente</b> · Modelagem 3D Master</span>
        </button>
      </div>

      ${
        this.mode === 'agente'
          ? `<div class="modix-ai-subbar">
              <span style="display:inline-flex;align-items:center;gap:5px;min-width:0;">
                ${hasPendingRefs ? Icons.scanEye : multiOn ? Icons.layers : Icons.bolt}
                <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                  ${
                    hasPendingRefs
                      ? `Réplica Fiel Ativa (${this.pendingRefs.length} ref${this.pendingRefs.length > 1 ? 's' : ''} + Inspeção 3D)`
                      : multiOn
                        ? 'Visão + Escultora Loft/Sweep + Inspetora 3D'
                        : 'Agente Direto'
                  }
                </span>
              </span>
              <button type="button" class="modix-ai-undo-chip" id="ai-quick-undo" title="Desfazer última alteração na cena">
                ${Icons.undo}<span>Undo 3D</span>
              </button>
            </div>`
          : `<div class="modix-ai-subbar ia-sub">
              <span style="display:inline-flex;align-items:center;gap:5px;">
                ${Icons.chat}
                <span>Modo Consulta: responde dúvidas e analisa fotos sem alterar a cena</span>
              </span>
            </div>`
      }

      ${
        this.showSettings
          ? `<div class="modix-ai-settings">
              <label class="modix-ai-chk">
                <input type="checkbox" id="ai-chk-multi" ${multiOn ? 'checked' : ''} />
                <span>Pipeline Multi-IA Completo (Visão Ortográfica + Modeladora Loft/Sweep + Texturas + Inspetora Visual 3D)</span>
              </label>
              <div style="font-size:10.5px;color:#a1a1aa;margin-top:6px;">
                OpenRouter API Key ${customKey ? '(Chave personalizada ativa)' : '(Chave integrada ativa)'}:
              </div>
              <div style="display:flex;gap:4px;margin-top:4px;">
                <input type="password" id="ai-key-input" class="modix-ai-key-inp" placeholder="Opcional: colar nova chave OpenRouter..." />
                <button type="button" class="modix-btn-sm primary" id="ai-key-save">Salvar</button>
                ${customKey ? `<button type="button" class="modix-btn-sm" id="ai-key-reset">Padrão</button>` : ''}
              </div>
            </div>`
          : ''
      }

      <div class="modix-ai-messages" id="ai-msg-list">
        ${this.history
          .map(
            (m) => `
          <div class="modix-ai-msg ${m.role} ${m.mode}">
            <div class="modix-ai-msg-meta" style="display:flex;align-items:center;gap:4px;">
              ${
                m.role === 'user'
                  ? `${Icons.user}<span>Você</span>`
                  : m.mode === 'agente'
                    ? `${Icons.bolt}<span>Agente 3D Master</span>`
                    : `${Icons.chat}<span>IA Assistente</span>`
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
                ? `<div class="modix-ai-steps">
                    ${m.agentSteps
                      .map(
                        (s) =>
                          `<div class="modix-ai-step-item" style="display:flex;align-items:center;gap:4px;">${Icons.check}<span>${escapeHtml(s)}</span></div>`
                      )
                      .join('')}
                   </div>`
                : ''
            }
          </div>`
          )
          .join('')}

        ${
          this.busy
            ? `<div class="modix-ai-live-status">
                <div class="modix-ai-spinner"></div>
                <div style="min-width:0;">
                  <div class="live-badge">${escapeHtml(liveBadge || (this.mode === 'agente' ? 'Equipe Multi-IA 3D' : 'IA Pensando'))}</div>
                  <div class="live-desc">${escapeHtml(liveStep || 'Consultando OpenRouter...')}</div>
                </div>
               </div>`
            : ''
        }
      </div>

      ${
        !this.busy
          ? `<div class="modix-ai-chips">
              ${quickPrompts
                .map(
                  (q) =>
                    `<button type="button" class="modix-ai-chip" data-prompt="${escapeHtml(q)}">${escapeHtml(q)}</button>`
                )
                .join('')}
            </div>`
          : ''
      }

      ${
        hasPendingRefs
          ? `<div class="modix-ai-ref-strip">
              <div class="modix-ai-ref-hdr">
                <span style="display:inline-flex;align-items:center;gap:5px;">
                  ${Icons.scanEye}
                  <span>Referências p/ Réplica 3D (${this.pendingRefs.length}/${MAX_REFERENCE_IMAGES})</span>
                </span>
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
                  <div class="modix-ai-ref-item" title="${escapeHtml(ref.name)} · Cores: ${ref.dominantColors.slice(0, 4).join(', ')}">
                    <img src="${ref.dataUrl}" alt="${escapeHtml(ref.name)}" />
                    <span class="modix-ai-ref-badge">#${idx + 1}</span>
                    ${
                      !this.busy
                        ? `<button type="button" class="modix-ai-ref-rm" data-rm-ref="${escapeHtml(ref.id)}" title="Remover imagem">${Icons.close}</button>`
                        : ''
                    }
                  </div>`
                  )
                  .join('')}
                ${
                  !this.busy && this.pendingRefs.length < MAX_REFERENCE_IMAGES
                    ? `<button type="button" class="modix-ai-ref-add-more" id="ai-btn-add-more-ref" title="Adicionar outro ângulo/foto de referência">
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
          title="Enviar uma ou várias imagens de referência (frente, lado, costas, detalhes)"
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
              ? 'Descreva detalhes extras ou envie direto p/ replicar as fotos...'
              : this.mode === 'agente'
                ? 'Anexe fotos de referência ou peça qualquer modelo 3D...'
                : 'Pergunte sobre modelagem 3D ou anexe fotos para análise...'
          }"
          autocomplete="off"
          ${this.busy ? 'disabled' : ''}
        />

        <button type="submit" class="modix-ai-send-btn" ${this.busy ? 'disabled' : ''} title="Enviar">
          ${this.busy ? '...' : Icons.sendArrow}
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
      this.history = [
        {
          role: 'assistant',
          mode: this.mode,
          content:
            this.mode === 'agente'
              ? 'Conversa limpa. Envie uma ou mais fotos de referência ou descreva o modelo 3D que deseja construir.'
              : 'Conversa limpa. Qual sua dúvida sobre modelagem 3D ou exportação?'
        }
      ];
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

    this.panelEl.querySelectorAll<HTMLButtonElement>('[data-prompt]').forEach((chip) => {
      chip.addEventListener('click', () => {
        const prompt = chip.dataset.prompt || '';
        if (prompt) void this.submitPrompt(prompt);
      });
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
          ? 'Escaneando Referências 3D'
          : 'Iniciando Equipe Multi-IA'
        : 'IA Assistente',
      attachedRefs.length > 0
        ? `Analisando ${attachedRefs.length} imagem(ns) de referência na OpenRouter Vision...`
        : 'Conectando à OpenRouter API...'
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
        this.showToast('Modelo 3D atualizado pelo Agente Master.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Restore attached refs if request failed so the user doesn't have to re-select them!
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
