import {
  askModixIA,
  hasCustomOpenRouterKey,
  isMultiAIEnabled,
  runModixMultiAgent,
  setCustomOpenRouterKey,
  setMultiAIEnabled,
  type ChatHistoryItem,
  type ChatRoleMode
} from '../ai/OpenRouterAgent';
import type { ModixEngine } from '../engine/ModixEngine';
import { Icons } from '../icons/blenderIcons';

export class AIChatPanel {
  private engine: ModixEngine;
  private showToast: (msg: string) => void;
  private panelEl: HTMLElement | null = null;
  private isOpen = false;
  private mode: ChatRoleMode = 'agente';
  private busy = false;
  private showSettings = false;
  private history: ChatHistoryItem[] = [
    {
      role: 'assistant',
      mode: 'agente',
      content:
        'Olá! Escolha acima entre **IA** (apenas responde dúvidas) ou **Agente** (equipe de várias IAs trabalhando juntas para criar modelos 3D completos, pintar, recortar malhas, agrupar e gerar texturas 512x512).'
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
    document.body.appendChild(this.panelEl);
  }

  private render(liveBadge = '', liveStep = ''): void {
    if (!this.panelEl) return;
    this.panelEl.style.display = this.isOpen ? 'flex' : 'none';
    if (!this.isOpen) return;

    const multiOn = isMultiAIEnabled();
    const customKey = hasCustomOpenRouterKey();

    const quickPrompts =
      this.mode === 'agente'
        ? [
            'Crie uma espada lendária detalhada com textura brilhante',
            'Construa uma casa com telhado, porta, janelas e jardim',
            'Crie um robô futurista sci-fi articulado em grupo',
            'Recorte o objeto selecionado ao meio no eixo Z',
            'Gere uma textura de lava vulcânica no objeto ativo'
          ]
        : [
            'Como exportar modelos .OBJ e .GLB com texturas e normais?',
            'Como recortar, unir e colocar objetos em grupo no Modix?'
          ];

    this.panelEl.innerHTML = `
      <div class="modix-ai-header">
        <div class="modix-ai-title">
          <span class="modix-ai-spark">${Icons.sparkles}</span>
          <span>Modix Studio AI</span>
        </div>
        <div style="display:flex;gap:5px;align-items:center;">
          <button class="modix-ai-icon-btn ${this.showSettings ? 'active' : ''}" id="ai-btn-settings" title="Configurações OpenRouter & Multi-IA">${Icons.settings}</button>
          <button class="modix-ai-icon-btn" id="ai-btn-clear" title="Limpar conversa">${Icons.trash}</button>
          <button class="modix-ai-icon-btn" id="ai-btn-close" title="Fechar">${Icons.close}</button>
        </div>
      </div>

      <!-- Mode Switcher: IA vs Agente -->
      <div class="modix-ai-mode-switch">
        <button class="modix-ai-mode-btn ${this.mode === 'ia' ? 'active ia' : ''}" data-mode="ia">
          ${Icons.chat}
          <span><b>IA</b> · Só Responde</span>
        </button>
        <button class="modix-ai-mode-btn ${this.mode === 'agente' ? 'active agente' : ''}" data-mode="agente">
          ${Icons.bolt}
          <span><b>Agente</b> · Cria &amp; Edita 3D</span>
        </button>
      </div>

      ${
        this.mode === 'agente'
          ? `<div class="modix-ai-subbar">
              <span style="display:inline-flex;align-items:center;gap:5px;">
                ${multiOn ? Icons.layers : Icons.bolt}
                <span>${multiOn ? 'Multi-IA Ativa: Arquiteta + Modeladora + Artista' : 'Agente Direto'}</span>
              </span>
              <button class="modix-ai-undo-chip" id="ai-quick-undo" title="Desfazer última alteração na cena">
                ${Icons.undo}<span>Undo 3D</span>
              </button>
            </div>`
          : `<div class="modix-ai-subbar ia-sub">
              <span style="display:inline-flex;align-items:center;gap:5px;">
                ${Icons.chat}
                <span>Modo Consulta: responde dúvidas sem alterar seus objetos 3D</span>
              </span>
            </div>`
      }

      ${
        this.showSettings
          ? `<div class="modix-ai-settings">
              <label class="modix-ai-chk">
                <input type="checkbox" id="ai-chk-multi" ${multiOn ? 'checked' : ''} />
                <span>Usar várias IAs trabalhando juntas (Arquiteta + Modeladora 3D + Artista de Texturas)</span>
              </label>
              <div style="font-size:10.5px;color:#a1a1aa;margin-top:6px;">
                OpenRouter API Key ${customKey ? '(Chave personalizada ativa)' : '(Chave integrada ativa)'}:
              </div>
              <div style="display:flex;gap:4px;margin-top:4px;">
                <input type="password" id="ai-key-input" class="modix-ai-key-inp" placeholder="Opcional: colar nova chave OpenRouter..." />
                <button class="modix-btn-sm primary" id="ai-key-save">Salvar</button>
                ${customKey ? `<button class="modix-btn-sm" id="ai-key-reset">Padrão</button>` : ''}
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
                    ? `${Icons.bolt}<span>Agente Multi-IA 3D</span>`
                    : `${Icons.chat}<span>IA Assistente</span>`
              }
            </div>
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
                <div>
                  <div class="live-badge">${escapeHtml(liveBadge || (this.mode === 'agente' ? 'Equipe Multi-IA' : 'IA Pensando'))}</div>
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
                    `<button class="modix-ai-chip" data-prompt="${escapeHtml(q)}">${escapeHtml(q)}</button>`
                )
                .join('')}
            </div>`
          : ''
      }

      <form class="modix-ai-input-bar" id="ai-chat-form">
        <input
          type="text"
          id="ai-chat-input"
          placeholder="${
            this.mode === 'agente'
              ? 'Peça para criar modelo 3D, pintar, recortar ou gerar textura...'
              : 'Pergunte qualquer coisa sobre modelagem 3D, UVs ou exportação...'
          }"
          autocomplete="off"
          ${this.busy ? 'disabled' : ''}
        />
        <button type="submit" class="modix-ai-send-btn" ${this.busy ? 'disabled' : ''}>
          ${this.busy ? '...' : 'Enviar'}
        </button>
      </form>
    `;

    const listEl = this.panelEl.querySelector<HTMLElement>('#ai-msg-list');
    if (listEl) listEl.scrollTop = listEl.scrollHeight;

    this.panelEl.querySelector('#ai-btn-close')?.addEventListener('click', () => this.close());
    this.panelEl.querySelector('#ai-btn-clear')?.addEventListener('click', () => {
      if (this.busy) return;
      this.history = [
        {
          role: 'assistant',
          mode: this.mode,
          content:
            this.mode === 'agente'
              ? 'Conversa limpa. O que nossa equipe de IAs deve modelar, recortar, pintar ou texturizar agora?'
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
      const inp = this.panelEl?.querySelector<HTMLInputElement>('#ai-key-input');
      if (inp && inp.value.trim()) {
        setCustomOpenRouterKey(inp.value.trim());
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
    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = inp?.value.trim() || '';
      if (val) void this.submitPrompt(val);
    });
  }

  private async submitPrompt(prompt: string): Promise<void> {
    if (this.busy) return;
    const activeMode = this.mode;
    const priorHistory = [...this.history];

    this.history.push({
      role: 'user',
      mode: activeMode,
      content: prompt
    });
    this.busy = true;
    this.render(
      activeMode === 'agente' ? 'Iniciando Equipe Multi-IA' : 'IA Assistente',
      'Conectando à OpenRouter API...'
    );

    try {
      if (activeMode === 'ia') {
        const answer = await askModixIA(prompt, priorHistory, this.engine);
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
          }
        );
        this.history.push({
          role: 'assistant',
          mode: 'agente',
          content: res.reply,
          agentSteps: res.steps
        });
        this.showToast('Agente 3D concluiu as alterações na cena.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
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
