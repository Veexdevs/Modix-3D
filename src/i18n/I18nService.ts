import { callOpenRouterChat } from '../ai/OpenRouterConfig';
import { Icons } from '../icons/blenderIcons';
import {
  searchWorldLanguages,
  WORLD_LANGUAGES,
  type WorldLanguageInfo
} from './worldLanguages';

const STORAGE_KEY_LANG = 'modix_app_language_v1';
const PACK_CACHE_PREFIX = 'modix_i18n_pack_v2_';

/**
 * Exact tokens that must NEVER be translated in any language:
 * App name ("Modix", "Modix 3D"), axes, and file format extensions.
 */
const PROTECTED_EXACT = new Set<string>([
  'Modix',
  'Modix 3D',
  'X',
  'Y',
  'Z',
  'UV',
  'PBR',
  'FPS',
  '.OBJ',
  '.GLB',
  '.GLTF',
  '.STL',
  '.PLY',
  '.DAE',
  '.USDZ',
  '.MTL',
  '.MODIX',
  '.PNG',
  '.JPG',
  '.SVG',
  '.FBX'
]);

/**
 * CSS selector matching all DOM subtrees containing:
 * - App brand name
 * - User's own account name & email
 * - User-created or renamed project names, scene names, object names, group/collection names
 * - File names & freeform user/AI chat messages & native language names in the language picker
 */
const PROTECTED_SUBTREE_SELECTOR = [
  '[data-no-i18n]',
  '.modix-brand-title',
  '.modix-hub-brand-title',
  '.modix-hub-card-title',
  '.modix-hub-profile-name',
  '.modix-hub-profile-email',
  '.obj-label',
  '.col-name-lbl',
  '#lbl-scene-name',
  '#lbl-vl-name',
  '.modix-ai-msg-text',
  '.modix-lang-native',
  'script',
  'style',
  'textarea'
].join(', ');

/**
 * Built-in instant offline dictionaries for major languages (0ms switch offline).
 * Every canonical UI phrase (both Portuguese & Blender-English source strings) maps cleanly.
 */
const BUILTIN_PACKS: Record<string, Record<string, string>> = {
  'pt-BR': {
    // Normalize English Blender workspace/menu/editor labels into full Portuguese when pt-BR is selected
    Layout: 'Layout',
    Modeling: 'Modelagem',
    Sculpting: 'Escultura',
    'UV Editing': 'Edição UV',
    'Texture Paint': 'Pintura de Textura',
    Shading: 'Sombreamento',
    Animation: 'Animação',
    Rendering: 'Renderização',
    Compositing: 'Composição',
    'Geometry Nodes': 'Nós de Geometria',
    Scripting: 'Scripts',
    File: 'Arquivo',
    Edit: 'Editar',
    Add: 'Adicionar',
    Mesh: 'Malha',
    Object: 'Objeto',
    Sculpt: 'Esculpir',
    Render: 'Renderizar',
    Window: 'Janela',
    Help: 'Ajuda',
    View: 'Vista',
    Select: 'Selecionar',
    Options: 'Opções',
    'Object Mode': 'Modo Objeto',
    'Edit Mode': 'Modo Edição',
    'Sculpt Mode': 'Modo Escultura',
    'Show Overlays & Grid': 'Mostrar Grade e Guias',
    'Toggle X-Ray': 'Alternar Raio-X',
    'Reset 3D Cursor to Origin': 'Resetar Cursor 3D na Origem',
    'Frame Selected': 'Enquadrar Selecionado',
    'Centered View': 'Vista Centralizada',
    'Toggle Camera View': 'Alternar Vista da Câmera',
    'Zoom View (drag or tap)': 'Zoom da Vista (arraste ou toque)',
    'Move / Pan View (drag)': 'Mover / Panorâmica (arraste)',
    'Perspective / Orthographic': 'Perspectiva / Ortográfica',
    Playback: 'Reprodução',
    Keying: 'Chaves',
    Marker: 'Marcador',
    Start: 'Início',
    End: 'Fim',
    'Auto Keying': 'Chave Automática',
    'Auto-Keying Enabled': 'Chave Automática Ativada',
    'Auto-Keying Disabled': 'Chave Automática Desativada',
    'Play Animation': 'Reproduzir Animação',
    'Play Reverse': 'Reproduzir Reverso',
    'Previous Keyframe': 'Quadro-Chave Anterior',
    'Next Keyframe': 'Próximo Quadro-Chave',
    'Jump to Endpoint': 'Ir para o Início',
    'Jump to End': 'Ir para o Fim',
    'Current Frame (drag to scrub)': 'Quadro Atual (arraste)',
    Transform: 'Transformação',
    'Delta Transform': 'Transformação Delta',
    Location: 'Posição',
    Rotation: 'Rotação',
    Scale: 'Escala',
    'Add Modifier': 'Adicionar Modificador',
    Apply: 'Aplicar',
    'Base Color': 'Cor Base',
    Metallic: 'Metálico',
    Roughness: 'Rugosidade',
    Emission: 'Emissão',
    Wireframe: 'Aramado',
    Solid: 'Sólido',
    'Subdivision Surface': 'Subdivisão de Superfície',
    Mirror: 'Espelhar',
    Array: 'Matriz (Array)',
    Solidify: 'Solidificar',
    Bevel: 'Chanfro (Bevel)',
    'Simple Deform (Twist)': 'Deformação Simples (Torcer)',
    'Shade Smooth': 'Sombreamento Suave',
    'Shade Flat': 'Sombreamento Plano',
    Extrude: 'Extrudar',
    Inset: 'Inserir Face (Inset)',
    'Loop Cut': 'Corte em Loop',
    Subdivide: 'Subdividir',
    Radius: 'Raio',
    Strength: 'Intensidade',
    Undo: 'Desfazer',
    Redo: 'Refazer',
    Global: 'Global',
    Local: 'Local',
    Normal: 'Normal',
    'Select Box': 'Caixa de Seleção',
    'Move (G)': 'Mover (G)',
    'Rotate (R)': 'Rotacionar (R)',
    'Scale (S)': 'Escalar (S)',
    Measure: 'Medir',
    Annotate: 'Anotar',
    'Add Cube': 'Adicionar Cubo',
    '3D Cursor': 'Cursor 3D',
    'Render Properties': 'Propriedades de Renderização',
    'Scene Properties': 'Propriedades da Cena',
    'World Properties': 'Propriedades do Mundo',
    'Object Properties': 'Propriedades do Objeto',
    'Modifier Properties': 'Modificadores',
    'Material Properties': 'Materiais PBR',
    'Run Script': 'Executar Script'
  },

  'pt-PT': {
    Projetos: 'Projetos',
    Recentes: 'Recentes',
    Configurações: 'Definições',
    Idioma: 'Idioma',
    Sobre: 'Sobre',
    Sair: 'Terminar Sessão',
    'Criar Conta': 'Criar Conta',
    Entrar: 'Iniciar Sessão',
    'Criar Conta e Entrar': 'Criar Conta e Entrar',
    'Entrar na Conta': 'Iniciar Sessão',
    'Escolher foto': 'Escolher fotografia',
    'Alterar Foto': 'Alterar Fotografia',
    'Deletar Conta Permanentemente': 'Eliminar Conta Permanentemente',
    'Deletar Conta': 'Eliminar Conta',
    'Excluir Projeto': 'Eliminar Projeto',
    'Buscar projeto...': 'Procurar projeto...',
    'Pesquisar idioma...': 'Procurar idioma...',
    'Selecionar Idioma': 'Selecionar Idioma',
    Modeling: 'Modelação',
    Sculpting: 'Escultura',
    File: 'Ficheiro',
    Edit: 'Editar',
    Add: 'Adicionar',
    Mesh: 'Malha',
    Object: 'Objeto',
    Render: 'Renderizar',
    Help: 'Ajuda'
  },

  en: {
    // Hub & Account
    Projetos: 'Projects',
    Recentes: 'Recents',
    Configurações: 'Settings',
    Idioma: 'Language',
    'Selecionar Idioma': 'Select Language',
    'Pesquisar idioma...': 'Search language...',
    'Nenhum idioma encontrado.': 'No language found.',
    'Traduzindo aplicativo...': 'Translating app...',
    Sobre: 'About',
    Sair: 'Sign Out',
    'Criar Conta': 'Create Account',
    Entrar: 'Sign In',
    'Criar Conta e Entrar': 'Create Account & Sign In',
    'Entrar na Conta': 'Sign In',
    'Já possui uma conta? Entrar': 'Already have an account? Sign In',
    'Ainda não tem conta? Criar Conta': "Don't have an account? Create Account",
    'Cadastre seu email para criar sua conta e sincronizar seus projetos 3D.':
      'Register your email to create your account and sync your 3D projects.',
    'Entre com seu email e senha para abrir seus projetos salvos.':
      'Sign in with your email and password to open your saved projects.',
    'Foto de perfil (opcional)': 'Profile photo (optional)',
    'Escolher foto': 'Choose photo',
    Nome: 'Name',
    'Seu nome ou estúdio': 'Your name or studio',
    Email: 'Email',
    'voce@email.com': 'you@email.com',
    Senha: 'Password',
    'Mínimo de 6 caracteres': 'Minimum 6 characters',
    'Sua senha': 'Your password',
    'Mostrar senha': 'Show password',
    'Ocultar senha': 'Hide password',
    'Conectando...': 'Connecting...',
    'Buscar projeto...': 'Search project...',
    'Buscar projetos': 'Search projects',
    'Novo Projeto 3D': 'New 3D Project',
    'Novo Projeto': 'New Project',
    'Nome do projeto:': 'Project name:',
    'Ex: Personagem, Carro, Cenário...': 'E.g. Character, Car, Environment...',
    'Criar e Abrir': 'Create & Open',
    'Importar .MODIX': 'Import .MODIX',
    'Exportar .MODIX': 'Export .MODIX',
    'Carregando seus projetos...': 'Loading your projects...',
    'Nenhum projeto encontrado para esta busca.': 'No projects found for this search.',
    'Nenhum projeto na sua conta ainda.': 'No projects in your account yet.',
    'Tente outro termo ou limpe o filtro de pesquisa.': 'Try another term or clear the search filter.',
    'Toque no botão + acima para criar seu primeiro projeto 3D ou importar um arquivo .MODIX.':
      'Tap the + button above to create your first 3D project or import a .MODIX file.',
    'Opções do projeto': 'Project options',
    'Abrir Projeto': 'Open Project',
    'Renomear Projeto...': 'Rename Project...',
    'Renomear Projeto': 'Rename Project',
    'Duplicar Projeto': 'Duplicate Project',
    'Excluir Projeto': 'Delete Project',
    'Alterar Foto': 'Change Photo',
    'Editar Nome': 'Edit Name',
    'Editar Nome da Conta': 'Edit Account Name',
    'Seu nome de exibição:': 'Your display name:',
    'Novo nome:': 'New name:',
    Salvar: 'Save',
    Padrão: 'Default',
    Cancelar: 'Cancel',
    Fechar: 'Close',
    Limpar: 'Clear',
    Remover: 'Remove',
    Enviar: 'Send',
    'Zona da Conta': 'Account Zone',
    'Deletar Conta Permanentemente': 'Delete Account Permanently',
    'Deletar Conta': 'Delete Account',
    'Excluindo...': 'Deleting...',
    'Você saiu da conta.': 'You signed out.',
    'Projeto renomeado.': 'Project renamed.',
    'Projeto duplicado.': 'Project duplicated.',
    'Projeto excluído.': 'Project deleted.',
    'Foto do perfil atualizada.': 'Profile photo updated.',
    'Nome atualizado.': 'Name updated.',
    'Sua conta e seus projetos foram excluídos.': 'Your account and projects have been deleted.',
    'IA & Agente OpenRouter': 'OpenRouter AI & Agent',
    'Chave personalizada OpenRouter ativa neste dispositivo.':
      'Custom OpenRouter key active on this device.',
    'Chave integrada ativa por padrão. Opcionalmente informe sua própria chave OpenRouter.':
      'Built-in key active by default. Optionally enter your own OpenRouter key.',
    'Opcional: sk-or-v1-...': 'Optional: sk-or-v1-...',
    'Estúdio 3D completo em modo paisagem para modelagem poligonal, curvas Loft & Sweep, escultura dinâmica, pintura PBR de texturas, animação por keyframes e Agente Multi-IA com fidelidade visual por múltiplas referências.':
      'Complete landscape 3D studio for polygonal modeling, Loft & Sweep curves, dynamic sculpting, PBR texture painting, keyframe animation, and Multi-AI Agent with multi-reference visual fidelity.',

    // AI & Agent Panel
    IA: 'AI',
    Agente: 'Agent',
    'IA / Agente': 'AI / Agent',
    'Agente 3D': '3D Agent',
    'Assistente IA': 'AI Assistant',
    Você: 'You',
    'Modo IA: responde dúvidas e analisa imagens sem alterar a cena':
      'AI Mode: answers questions and analyzes images without modifying the scene',
    'Modo Agente: modela, esculpe, pinta e replica referências em 3D':
      'Agent Mode: buildsconnected meshes, sculpts, paints, and replicates 3D references',
    'Desfazer última ação 3D': 'Undo last 3D action',
    'Limpar conversa': 'Clear chat',
    'Pipeline Multi-IA (Visão + Modelagem + Inspeção 3D)':
      'Multi-AI Pipeline (Vision + Mesh & 3D Modeling + 3D Inspection)',
    'Modelo de IA (OpenRouter)': 'AI Model (OpenRouter)',
    'Auto (Melhores IAs do Mundo em Conjunto)': 'Auto (World’s Best AIs Ensemble)',
    'Peça qualquer modelo 3D ou anexe fotos de referência para réplica fiel.':
      'Request any connected Mesh / 3D model or attach reference photos for a faithful replica.',
    'Tire dúvidas sobre modelagem, topologia, texturas ou exportação 3D.':
      'Ask questions about modeling, topology, textures, or 3D export.',
    'Anexar imagens de referência': 'Attach reference images',
    'Adicionar outra referência': 'Add another reference',
    'Detalhes opcionais ou envie direto...': 'Optional details or send directly...',
    'Descreva o modelo 3D...': 'Describe the 3D / Mesh model...',
    'Pergunte algo...': 'Ask anything...',
    'Processando...': 'Processing...',
    'Cena 3D atualizada pelo Agente.': '3D scene updated by Agent.',
    'Última ação 3D desfeita': 'Last 3D action undone',
    'Nada para desfazer': 'Nothing to undo',

    // Editor & Modals
    'Salvar e voltar para a tela de Projetos': 'Save and return to Projects screen',
    'Abrir Chat com IA ou Agente Multi-IA 3D': 'Open AI Chat or Multi-AI 3D Agent',
    'Modix 3D foi desenhado para tela deitada (Landscape). Gire o aparelho para a experiência completa.':
      'Modix 3D is designed for landscape orientation. Rotate your device for the full experience.',
    'Segure aqui embaixo do Explorer e puxe para cima ou para baixo':
      'Hold below the Explorer and drag up or down to resize',
    'Unir Selecionados': 'Join Selected',
    'Fundir em Mesh Suave': 'Fuse into Smooth Mesh',
    'Separar Partes': 'Separate Loose Parts',
    'Recortar / Fatiar Malha 3D': 'Slice / Cut 3D Mesh',
    'Recortar / Fatiar Malha 3D...': 'Slice / Cut 3D Mesh...',
    'Central de Exportação 3D': '3D Export Hub',
    'Central de Exportação Completa...': 'Full 3D Export Hub...',
    'Exportar Modelo 3D': 'Export 3D Model',
    'Importar Arquivo 3D...': 'Import 3D File...',
    'Salvar Projeto Agora': 'Save Project Now',
    'Reiniciar Cena Padrão': 'Reset Default Scene',
    'Cena reiniciada.': 'Scene reset.',
    'Renomear Objeto': 'Rename Object',
    'Renomear Grupo': 'Rename Group',
    'Renomear Grupo...': 'Rename Group...',
    'Renomear...': 'Rename...',
    'Criar Novo Grupo...': 'Create New Group...',
    'Agrupar Selecionados...': 'Group Selected...',
    'Mostrar / Ocultar': 'Show / Hide',
    Copiar: 'Copy',
    Colar: 'Paste',
    Duplicar: 'Duplicate',
    Deletar: 'Delete',
    Desfazer: 'Undo',
    Refazer: 'Redo',
    'Estúdio de Texturas 2D / 3D': '2D / 3D Texture Studio',
    'Desenhar / Pintar Textura...': 'Draw / Paint Texture...',
    'Pintar Direto no Modelo 3D': 'Paint Directly on 3D Model',
    'Aplicar no 3D': 'Apply to 3D',
    'Renderizar Imagem (1280 x 720 PNG)': 'Render Image (1280 x 720 PNG)'
  },

  es: {
    Projetos: 'Proyectos',
    Recentes: 'Recientes',
    Configurações: 'Configuración',
    Idioma: 'Idioma',
    'Selecionar Idioma': 'Seleccionar Idioma',
    'Pesquisar idioma...': 'Buscar idioma...',
    'Nenhum idioma encontrado.': 'No se encontró ningún idioma.',
    'Traduzindo aplicativo...': 'Traduciendo aplicación...',
    Sobre: 'Acerca de',
    Sair: 'Cerrar sesión',
    'Criar Conta': 'Crear Cuenta',
    Entrar: 'Iniciar Sesión',
    'Criar Conta e Entrar': 'Crear Cuenta y Entrar',
    'Entrar na Conta': 'Iniciar Sesión',
    'Já possui uma conta? Entrar': '¿Ya tienes una cuenta? Iniciar Sesión',
    'Ainda não tem conta? Criar Conta': '¿Aún no tienes cuenta? Crear Cuenta',
    'Cadastre seu email para criar sua conta e sincronizar seus projetos 3D.':
      'Registra tu correo para crear tu cuenta y sincronizar tus proyectos 3D.',
    'Entre com seu email e senha para abrir seus projetos salvos.':
      'Inicia sesión con tu correo y contraseña para abrir tus proyectos guardados.',
    'Foto de perfil (opcional)': 'Foto de perfil (opcional)',
    'Escolher foto': 'Elegir foto',
    Nome: 'Nombre',
    'Seu nome ou estúdio': 'Tu nombre o estudio',
    Email: 'Correo electrónico',
    Senha: 'Contraseña',
    'Mínimo de 6 caracteres': 'Mínimo 6 caracteres',
    'Sua senha': 'Tu contraseña',
    'Conectando...': 'Conectando...',
    'Buscar projeto...': 'Buscar proyecto...',
    'Novo Projeto 3D': 'Nuevo Proyecto 3D',
    'Novo Projeto': 'Nuevo Proyecto',
    'Nome do projeto:': 'Nombre del proyecto:',
    'Criar e Abrir': 'Crear y Abrir',
    'Importar .MODIX': 'Importar .MODIX',
    'Exportar .MODIX': 'Exportar .MODIX',
    'Carregando seus projetos...': 'Cargando tus proyectos...',
    'Nenhum projeto na sua conta ainda.': 'Aún no hay proyectos en tu cuenta.',
    'Abrir Projeto': 'Abrir Proyecto',
    'Renomear Projeto...': 'Renombrar Proyecto...',
    'Duplicar Projeto': 'Duplicar Proyecto',
    'Excluir Projeto': 'Eliminar Proyecto',
    'Alterar Foto': 'Cambiar Foto',
    'Editar Nome': 'Editar Nombre',
    Salvar: 'Guardar',
    Padrão: 'Predeterminado',
    Cancelar: 'Cancelar',
    Fechar: 'Cerrar',
    Limpar: 'Limpiar',
    Enviar: 'Enviar',
    'Deletar Conta Permanentemente': 'Eliminar Cuenta Permanentemente',
    'Deletar Conta': 'Eliminar Cuenta',
    IA: 'IA',
    Agente: 'Agente',
    'IA / Agente': 'IA / Agente',
    'Agente 3D': 'Agente 3D',
    'Assistente IA': 'Asistente IA',
    Você: 'Tú',
    'Descreva o modelo 3D...': 'Describe el modelo 3D o Mesh...',
    'Pergunte algo...': 'Pregunta algo...',
    'Modelo de IA (OpenRouter)': 'Modelo de IA (OpenRouter)',
    'Auto (Melhores IAs do Mundo em Conjunto)': 'Auto (Mejores IAs del Mundo en Conjunto)',
    Layout: 'Diseño',
    Modeling: 'Modelado',
    Sculpting: 'Esculpido',
    'UV Editing': 'Edición UV',
    'Texture Paint': 'Pintura de Textura',
    Shading: 'Sombreado',
    Animation: 'Animación',
    File: 'Archivo',
    Edit: 'Editar',
    Add: 'Añadir',
    Mesh: 'Malla',
    Object: 'Objeto',
    Sculpt: 'Esculpir',
    Render: 'Renderizar',
    Window: 'Ventana',
    Help: 'Ayuda',
    View: 'Vista',
    Select: 'Seleccionar',
    Options: 'Opciones',
    'Object Mode': 'Modo Objeto',
    'Edit Mode': 'Modo Edición',
    'Sculpt Mode': 'Modo Esculpido',
    Location: 'Posición',
    Rotation: 'Rotación',
    Scale: 'Escala',
    'Add Modifier': 'Añadir Modificador',
    'Base Color': 'Color Base',
    Metallic: 'Metálico',
    Roughness: 'Rugosidad',
    'Fundir em Mesh Suave': 'Fusionar en Malla Suave',
    'Unir Selecionados': 'Unir Seleccionados'
  },

  fr: {
    Projetos: 'Projets',
    Recentes: 'Récents',
    Configurações: 'Paramètres',
    Idioma: 'Langue',
    'Selecionar Idioma': 'Choisir la langue',
    'Pesquisar idioma...': 'Rechercher une langue...',
    'Nenhum idioma encontrado.': 'Aucune langue trouvée.',
    'Traduzindo aplicativo...': "Traduction de l'application...",
    Sobre: 'À propos',
    Sair: 'Déconnexion',
    'Criar Conta': 'Créer un compte',
    Entrar: 'Connexion',
    'Criar Conta e Entrar': 'Créer un compte et entrer',
    'Entrar na Conta': 'Se connecter',
    'Escolher foto': 'Choisir une photo',
    Nome: 'Nom',
    Email: 'E-mail',
    Senha: 'Mot de passe',
    'Buscar projeto...': 'Rechercher un projet...',
    'Novo Projeto 3D': 'Nouveau Projet 3D',
    'Novo Projeto': 'Nouveau Projet',
    'Criar e Abrir': 'Créer et Ouvrir',
    'Nenhum projeto na sua conta ainda.': 'Aucun projet sur votre compte pour le moment.',
    'Abrir Projeto': 'Ouvrir le projet',
    'Renomear Projeto...': 'Renommer le projet...',
    'Duplicar Projeto': 'Dupliquer le projet',
    'Excluir Projeto': 'Supprimer le projet',
    'Alterar Foto': 'Changer la photo',
    'Editar Nome': 'Modifier le nom',
    Salvar: 'Enregistrer',
    Padrão: 'Par défaut',
    Cancelar: 'Annuler',
    Fechar: 'Fermer',
    Limpar: 'Effacer',
    Enviar: 'Envoyer',
    'Deletar Conta Permanentemente': 'Supprimer le compte définitivement',
    IA: 'IA',
    Agente: 'Agent',
    'IA / Agente': 'IA / Agent',
    Você: 'Vous',
    'Descreva o modelo 3D...': 'Décrivez le modèle 3D...',
    'Pergunte algo...': 'Posez une question...',
    Layout: 'Disposition',
    Modeling: 'Modélisation',
    Sculpting: 'Sculpture',
    'UV Editing': 'Édition UV',
    'Texture Paint': 'Peinture de texture',
    Shading: 'Ombrage',
    Animation: 'Animation',
    File: 'Fichier',
    Edit: 'Édition',
    Add: 'Ajouter',
    Mesh: 'Maillage',
    Object: 'Objet',
    Sculpt: 'Sculpter',
    Render: 'Rendu',
    Window: 'Fenêtre',
    Help: 'Aide',
    View: 'Vue',
    Select: 'Sélectionner',
    Options: 'Options',
    'Object Mode': 'Mode Objet',
    'Edit Mode': 'Mode Édition',
    'Sculpt Mode': 'Mode Sculpture',
    Location: 'Position',
    Rotation: 'Rotation',
    Scale: 'Échelle',
    'Add Modifier': 'Ajouter un modificateur',
    'Base Color': 'Couleur de base',
    Metallic: 'Métallique',
    Roughness: 'Rugosité',
    'Fundir em Mesh Suave': 'Fusionner en Maillage Lisse'
  },

  de: {
    Projetos: 'Projekte',
    Recentes: 'Zuletzt',
    Configurações: 'Einstellungen',
    Idioma: 'Sprache',
    'Selecionar Idioma': 'Sprache auswählen',
    'Pesquisar idioma...': 'Sprache suchen...',
    'Nenhum idioma encontrado.': 'Keine Sprache gefunden.',
    'Traduzindo aplicativo...': 'App wird übersetzt...',
    Sobre: 'Über',
    Sair: 'Abmelden',
    'Criar Conta': 'Konto erstellen',
    Entrar: 'Anmelden',
    'Criar Conta e Entrar': 'Konto erstellen & anmelden',
    'Entrar na Conta': 'Anmelden',
    'Escolher foto': 'Foto auswählen',
    Nome: 'Name',
    Email: 'E-Mail',
    Senha: 'Passwort',
    'Buscar projeto...': 'Projekt suchen...',
    'Novo Projeto 3D': 'Neues 3D-Projekt',
    'Novo Projeto': 'Neues Projekt',
    'Criar e Abrir': 'Erstellen & Öffnen',
    'Nenhum projeto na sua conta ainda.': 'Noch keine Projekte in Ihrem Konto.',
    'Abrir Projeto': 'Projekt öffnen',
    'Renomear Projeto...': 'Projekt umbenennen...',
    'Duplicar Projeto': 'Projekt duplizieren',
    'Excluir Projeto': 'Projekt löschen',
    'Alterar Foto': 'Foto ändern',
    'Editar Nome': 'Name bearbeiten',
    Salvar: 'Speichern',
    Padrão: 'Standard',
    Cancelar: 'Abbrechen',
    Fechar: 'Schließen',
    Limpar: 'Leeren',
    Enviar: 'Senden',
    'Deletar Conta Permanentemente': 'Konto dauerhaft löschen',
    IA: 'KI',
    Agente: 'Agent',
    'IA / Agente': 'KI / Agent',
    Você: 'Sie',
    'Descreva o modelo 3D...': '3D-Modell beschreiben...',
    'Pergunte algo...': 'Etwas fragen...',
    Layout: 'Layout',
    Modeling: 'Modellierung',
    Sculpting: 'Skulptur',
    'UV Editing': 'UV-Bearbeitung',
    'Texture Paint': 'Texturmalerei',
    Shading: 'Shading',
    Animation: 'Animation',
    File: 'Datei',
    Edit: 'Bearbeiten',
    Add: 'Hinzufügen',
    Mesh: 'Mesh',
    Object: 'Objekt',
    Sculpt: 'Skulpturieren',
    Render: 'Rendern',
    Window: 'Fenster',
    Help: 'Hilfe',
    View: 'Ansicht',
    Select: 'Auswählen',
    Options: 'Optionen',
    'Object Mode': 'Objektmodus',
    'Edit Mode': 'Bearbeitungsmodus',
    'Sculpt Mode': 'Skulpturmodus',
    Location: 'Position',
    Rotation: 'Rotation',
    Scale: 'Skalierung',
    'Add Modifier': 'Modifikator hinzufügen',
    'Base Color': 'Grundfarbe',
    Metallic: 'Metallisch',
    Roughness: 'Rauheit',
    'Fundir em Mesh Suave': 'Zu glattem Mesh verschmelzen'
  },

  it: {
    Projetos: 'Progetti',
    Recentes: 'Recenti',
    Configurações: 'Impostazioni',
    Idioma: 'Lingua',
    'Selecionar Idioma': 'Seleziona Lingua',
    'Pesquisar idioma...': 'Cerca lingua...',
    Sobre: 'Informazioni',
    Sair: 'Esci',
    'Criar Conta': 'Crea Account',
    Entrar: 'Accedi',
    Nome: 'Nome',
    Senha: 'Password',
    'Buscar projeto...': 'Cerca progetto...',
    'Novo Projeto': 'Nuovo Progetto',
    Salvar: 'Salva',
    Cancelar: 'Annulla',
    Fechar: 'Chiudi',
    IA: 'IA',
    Agente: 'Agente',
    'IA / Agente': 'IA / Agente',
    Modeling: 'Modellazione',
    Sculpting: 'Scultura',
    Animation: 'Animazione',
    File: 'File',
    Edit: 'Modifica',
    Add: 'Aggiungi',
    Mesh: 'Mesh',
    Object: 'Oggetto',
    Render: 'Render',
    Help: 'Aiuto',
    Location: 'Posizione',
    Rotation: 'Rotazione',
    Scale: 'Scala'
  },

  ja: {
    Projetos: 'プロジェクト',
    Recentes: '最近',
    Configurações: '設定',
    Idioma: '言語',
    'Selecionar Idioma': '言語を選択',
    'Pesquisar idioma...': '言語を検索...',
    'Nenhum idioma encontrado.': '言語が見つかりません。',
    'Traduzindo aplicativo...': 'アプリを翻訳中...',
    Sobre: '情報',
    Sair: 'ログアウト',
    'Criar Conta': 'アカウント作成',
    Entrar: 'ログイン',
    'Criar Conta e Entrar': '作成してログイン',
    'Entrar na Conta': 'ログイン',
    Nome: '名前',
    Email: 'メール',
    Senha: 'パスワード',
    'Buscar projeto...': 'プロジェクトを検索...',
    'Novo Projeto 3D': '新規3Dプロジェクト',
    'Novo Projeto': '新規プロジェクト',
    'Criar e Abrir': '作成して開く',
    'Nenhum projeto na sua conta ainda.': 'プロジェクトがまだありません。',
    'Abrir Projeto': 'プロジェクトを開く',
    'Renomear Projeto...': '名前を変更...',
    'Duplicar Projeto': '複製',
    'Excluir Projeto': '削除',
    'Alterar Foto': '写真を変更',
    'Editar Nome': '名前を編集',
    Salvar: '保存',
    Padrão: '標準',
    Cancelar: 'キャンセル',
    Fechar: '閉じる',
    Limpar: 'クリア',
    Enviar: '送信',
    'Deletar Conta Permanentemente': 'アカウントを完全に削除',
    IA: 'AI',
    Agente: 'エージェント',
    'IA / Agente': 'AI / エージェント',
    Você: 'あなた',
    'Descreva o modelo 3D...': '3Dモデル・メッシュを説明...',
    'Pergunte algo...': '質問を入力...',
    Layout: 'レイアウト',
    Modeling: 'モデリング',
    Sculpting: 'スカルプト',
    'UV Editing': 'UV編集',
    'Texture Paint': 'テクスチャペイント',
    Shading: 'シェーディング',
    Animation: 'アニメーション',
    File: 'ファイル',
    Edit: '編集',
    Add: '追加',
    Mesh: 'メッシュ',
    Object: 'オブジェクト',
    Sculpt: 'スカルプト',
    Render: 'レンダー',
    Window: 'ウィンドウ',
    Help: 'ヘルプ',
    View: 'ビュー',
    Select: '選択',
    Options: 'オプション',
    'Object Mode': 'オブジェクトモード',
    'Edit Mode': '編集モード',
    'Sculpt Mode': 'スカルプトモード',
    Location: '位置',
    Rotation: '回転',
    Scale: 'スケール',
    'Add Modifier': 'モディファイアを追加',
    'Base Color': 'ベースカラー',
    Metallic: 'メタリック',
    Roughness: '粗さ',
    'Fundir em Mesh Suave': '滑らかなメッシュに統合'
  },

  ko: {
    Projetos: '프로젝트',
    Recentes: '최근 항목',
    Configurações: '설정',
    Idioma: '언어',
    'Selecionar Idioma': '언어 선택',
    'Pesquisar idioma...': '언어 검색...',
    'Traduzindo aplicativo...': '앱 번역 중...',
    Sobre: '정보',
    Sair: '로그아웃',
    'Criar Conta': '계정 만들기',
    Entrar: '로그인',
    Nome: '이름',
    Email: '이메일',
    Senha: '비밀번호',
    'Buscar projeto...': '프로젝트 검색...',
    'Novo Projeto': '새 프로젝트',
    'Criar e Abrir': '만들기 및 열기',
    Salvar: '저장',
    Cancelar: '취소',
    Fechar: '닫기',
    Limpar: '지우기',
    Enviar: '보내기',
    IA: 'AI',
    Agente: '에이전트',
    'IA / Agente': 'AI / 에이전트',
    Você: '나',
    'Descreva o modelo 3D...': '3D 모델 설명...',
    'Pergunte algo...': '무엇이든 물어보세요...',
    Layout: '레이아웃',
    Modeling: '모델링',
    Sculpting: '스컬프팅',
    'UV Editing': 'UV 편집',
    'Texture Paint': '텍스처 페인트',
    Shading: '셰이딩',
    Animation: '애니메이션',
    File: '파일',
    Edit: '편집',
    Add: '추가',
    Mesh: '메시',
    Object: '오브젝트',
    Sculpt: '스컬프트',
    Render: '렌더',
    Window: '창',
    Help: '도움말',
    Location: '위치',
    Rotation: '회전',
    Scale: '크기',
    'Add Modifier': '모디파이어 추가',
    'Fundir em Mesh Suave': '부드러운 메시로 결합'
  },

  'zh-CN': {
    Projetos: '项目',
    Recentes: '最近',
    Configurações: '设置',
    Idioma: '语言',
    'Selecionar Idioma': '选择语言',
    'Pesquisar idioma...': '搜索语言...',
    'Traduzindo aplicativo...': '正在翻译应用...',
    Sobre: '关于',
    Sair: '退出登录',
    'Criar Conta': '创建账户',
    Entrar: '登录',
    Nome: '名称',
    Email: '邮箱',
    Senha: '密码',
    'Buscar projeto...': '搜索项目...',
    'Novo Projeto': '新建项目',
    'Criar e Abrir': '创建并打开',
    Salvar: '保存',
    Cancelar: '取消',
    Fechar: '关闭',
    Limpar: '清空',
    Enviar: '发送',
    IA: 'AI',
    Agente: '智能体',
    'IA / Agente': 'AI / 智能体',
    Você: '你',
    'Descreva o modelo 3D...': '描述 3D / 网格模型...',
    'Pergunte algo...': '输入问题...',
    Layout: '布局',
    Modeling: '建模',
    Sculpting: '雕刻',
    'UV Editing': 'UV 编辑',
    'Texture Paint': '纹理绘制',
    Shading: '着色',
    Animation: '动画',
    File: '文件',
    Edit: '编辑',
    Add: '添加',
    Mesh: '网格',
    Object: '物体',
    Sculpt: '雕刻',
    Render: '渲染',
    Window: '窗口',
    Help: '帮助',
    Location: '位置',
    Rotation: '旋转',
    Scale: '缩放',
    'Add Modifier': '添加修改器',
    'Fundir em Mesh Suave': '融合为平滑网格'
  },

  ru: {
    Projetos: 'Проекты',
    Recentes: 'Недавние',
    Configurações: 'Настройки',
    Idioma: 'Язык',
    'Selecionar Idioma': 'Выбрать язык',
    'Pesquisar idioma...': 'Поиск языка...',
    'Traduzindo aplicativo...': 'Перевод приложения...',
    Sobre: 'О программе',
    Sair: 'Выйти',
    'Criar Conta': 'Создать аккаунт',
    Entrar: 'Войти',
    Nome: 'Имя',
    Email: 'Эл. почта',
    Senha: 'Пароль',
    'Buscar projeto...': 'Поиск проекта...',
    'Novo Projeto': 'Новый проект',
    Salvar: 'Сохранить',
    Cancelar: 'Отмена',
    Fechar: 'Закрыть',
    Enviar: 'Отправить',
    IA: 'ИИ',
    Agente: 'Агент',
    'IA / Agente': 'ИИ / Агент',
    Layout: 'Макет',
    Modeling: 'Моделирование',
    Sculpting: 'Скульптинг',
    Animation: 'Анимация',
    File: 'Файл',
    Edit: 'Правка',
    Add: 'Добавить',
    Mesh: 'Меш',
    Object: 'Объект',
    Render: 'Рендер',
    Help: 'Справка',
    Location: 'Положение',
    Rotation: 'Вращение',
    Scale: 'Масштаб'
  },

  ar: {
    Projetos: 'المشاريع',
    Recentes: 'الأخيرة',
    Configurações: 'الإعدادات',
    Idioma: 'اللغة',
    'Selecionar Idioma': 'اختر اللغة',
    'Pesquisar idioma...': 'ابحث عن لغة...',
    'Traduzindo aplicativo...': 'جاري ترجمة التطبيق...',
    Sobre: 'حول',
    Sair: 'تسجيل الخروج',
    'Criar Conta': 'إنشاء حساب',
    Entrar: 'تسجيل الدخول',
    Nome: 'الاسم',
    Email: 'البريد الإلكتروني',
    Senha: 'كلمة المرور',
    'Buscar projeto...': 'البحث عن مشروع...',
    'Novo Projeto': 'مشروع جديد',
    Salvar: 'حفظ',
    Cancelar: 'إلغاء',
    Fechar: 'إغلاق',
    Enviar: 'إرسال',
    IA: 'ذكاء اصطناعي',
    Agente: 'وكيل 3D',
    'IA / Agente': 'ذكاء / وكيل',
    Layout: 'التخطيط',
    Modeling: 'النمذجة',
    Sculpting: 'النحت',
    Animation: 'التحريك',
    File: 'ملف',
    Edit: 'تحرير',
    Add: 'إضافة',
    Mesh: 'شبكة',
    Object: 'كائن',
    Render: 'تصيير',
    Help: 'مساعدة',
    Location: 'الموقع',
    Rotation: 'الدوران',
    Scale: 'الحجم'
  }
};

type LanguageChangeListener = (lang: WorldLanguageInfo) => void;

const textNodeOriginal = new WeakMap<Text, string>();
const attrOriginal = new WeakMap<Element, Record<string, string>>();
const runtimePacks = new Map<string, Record<string, string>>();
const listeners = new Set<LanguageChangeListener>();
const pendingMissingStrings = new Set<string>();

let activeLangCode = loadInitialLanguageCode();
let domObserverInstalled = false;
let isApplyingDom = false;
let batchTranslateTimer: number | undefined;
let inflightPackPromise: Promise<void> | null = null;

function loadInitialLanguageCode(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_LANG)?.trim();
    if (saved && WORLD_LANGUAGES.some((l) => l.code === saved)) {
      return saved;
    }
  } catch {
    // ignore
  }
  return 'pt-BR';
}

function getCombinedDictionary(code: string): Record<string, string> {
  if (runtimePacks.has(code)) {
    return runtimePacks.get(code)!;
  }
  const baseLang = code.split('-')[0];
  const builtin = {
    ...(BUILTIN_PACKS[baseLang] || {}),
    ...(BUILTIN_PACKS[code] || {})
  };
  let cached: Record<string, string> = {};
  try {
    const raw = localStorage.getItem(`${PACK_CACHE_PREFIX}${code}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        cached = parsed as Record<string, string>;
      }
    }
  } catch {
    // ignore
  }
  const merged = { ...cached, ...builtin };
  runtimePacks.set(code, merged);
  return merged;
}

function savePackToCache(code: string, dict: Record<string, string>): void {
  runtimePacks.set(code, dict);
  try {
    localStorage.setItem(`${PACK_CACHE_PREFIX}${code}`, JSON.stringify(dict));
  } catch {
    // ignore storage quota
  }
}

export function getActiveLanguageCode(): string {
  return activeLangCode;
}

export function getActiveLanguageInfo(): WorldLanguageInfo {
  return (
    WORLD_LANGUAGES.find((l) => l.code === activeLangCode) || WORLD_LANGUAGES[0]
  );
}

export function onLanguageChange(fn: LanguageChangeListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function looksLikeStandaloneFileName(s: string): boolean {
  return /^[^\s/\\]+\.(obj|glb|gltf|fbx|stl|ply|dae|usdz|3mf|amf|off|svg|modix|json|png|jpg|jpeg|webp|mtl)$/i.test(
    s.trim()
  );
}

function shouldNeverTranslateString(raw: string): boolean {
  const s = raw.trim();
  if (!s || s.length < 2) return true;
  if (PROTECTED_EXACT.has(s)) return true;
  if (looksLikeStandaloneFileName(s)) return true;
  // Pure numbers, dimensions, frames, percentages, hex codes, shortcuts
  if (/^[#0-9.,:%+\-*/()[\]\s•|x×°mpxfs]+$/i.test(s)) return true;
  if (/^(Ctrl|Shift|Alt|Tab|G|R|S|X|Y|Z)(\+[A-Z0-9]+)*$/.test(s)) return true;
  if (/^#\d+$/.test(s)) return true;
  if (/^sk-or-/i.test(s)) return true;
  // Must contain at least one letter from any script
  if (!/\p{L}/u.test(s)) return true;
  return false;
}

/**
 * Translates a canonical UI phrase into the active language while strictly preserving
 * brand names ("Modix", "Modix 3D"), filenames, and quoted user-defined names.
 */
export function tr(canonical: string): string {
  const trimmed = canonical.trim();
  if (!trimmed || shouldNeverTranslateString(trimmed)) return canonical;

  // Mask any quoted user-defined names / filenames ("MeuCarro", "espada.obj") so they NEVER change!
  const quotedValues: string[] = [];
  const masked = trimmed.replace(/"([^"]+)"/g, (_full, inner: string) => {
    const idx = quotedValues.length;
    quotedValues.push(inner);
    return `{q${idx}}`;
  });
  const restoreQuotes = (str: string): string =>
    str.replace(/\{q(\d+)\}/g, (_m, idxStr: string) => {
      const val = quotedValues[Number(idxStr)];
      return val !== undefined ? `"${val}"` : _m;
    });

  // If the entire string was just a single quoted name like `"Cube"`, never translate it!
  if (/^\{q\d+\}$/.test(masked)) {
    return canonical;
  }

  const dict = getCombinedDictionary(activeLangCode);

  // 1. Direct exact hit (either unmasked or masked template)
  if (dict[trimmed]) {
    return preserveOuterWhitespace(canonical, enforceBrandProtection(dict[trimmed]));
  }
  if (quotedValues.length > 0 && dict[masked]) {
    return preserveOuterWhitespace(
      canonical,
      restoreQuotes(enforceBrandProtection(dict[masked]))
    );
  }

  // 2. Built-in masked quote templates for English offline
  if (quotedValues.length > 0 && activeLangCode === 'en') {
    const enTemplates: Record<string, string> = {
      'Projeto {q0} salvo.': 'Project {q0} saved.',
      'Mover para {q0}': 'Move to {q0}',
      'Movido para {q0}': 'Moved to {q0}',
      'Movido para grupo {q0}': 'Moved to group {q0}',
      'Objeto: {q0}': 'Object: {q0}',
      'Grupo: {q0}': 'Group: {q0}',
      'Renomeado para {q0}': 'Renamed to {q0}',
      'Grupo {q0} criado': 'Group {q0} created',
      'Grupo {q0} criado!': 'Group {q0} created!',
      'Textura {q0} aplicada!': 'Texture {q0} applied!'
    };
    if (enTemplates[masked]) {
      return preserveOuterWhitespace(canonical, restoreQuotes(enTemplates[masked]));
    }
  }

  // 3. Dynamic pattern: "Referências (2/8)"
  const refMatch = trimmed.match(/^Referências\s*\((\d+\/\d+)\)$/i);
  if (refMatch) {
    const word = dict['Referências'] || (activeLangCode === 'en' ? 'References' : '');
    if (word) return preserveOuterWhitespace(canonical, `${word} (${refMatch[1]})`);
  }

  // 4. Dynamic pattern: "N etapa(s) executada(s)"
  const stepsMatch = trimmed.match(/^(\d+)\s+etapas?\s+executadas?$/i);
  if (stepsMatch) {
    const tpl =
      dict['{n} etapas executadas'] ||
      (activeLangCode === 'en' ? '{n} steps executed' : '');
    if (tpl) {
      return preserveOuterWhitespace(canonical, tpl.replace('{n}', stepsMatch[1]));
    }
  }

  // 5. Queue missing UI phrase (using masked template so user names NEVER leak or change)
  if (activeLangCode !== 'pt-BR') {
    queueMissingUiString(quotedValues.length > 0 ? masked : trimmed);
  }

  return canonical;
}

function preserveOuterWhitespace(original: string, translatedTrimmed: string): string {
  const lead = original.match(/^\s*/)?.[0] || '';
  const trail = original.match(/\s*$/)?.[0] || '';
  return `${lead}${translatedTrimmed}${trail}`;
}

function enforceBrandProtection(text: string): string {
  // Ensure "Modix 3D" and "Modix" are never transliterated or altered
  return text.replace(/modix\s*3d/gi, 'Modix 3D').replace(/modix/gi, (m) =>
    m[0] === 'M' ? 'Modix' : m
  );
}

function isInsideProtectedSubtree(node: Node): boolean {
  const el =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement;
  if (!el) return true;
  return Boolean(el.closest(PROTECTED_SUBTREE_SELECTOR));
}

function translateDomSubtree(root: Node): void {
  if (!root) return;

  if (root.nodeType === Node.TEXT_NODE) {
    const tNode = root as Text;
    if (isInsideProtectedSubtree(tNode)) return;
    const current = tNode.nodeValue || '';
    if (!textNodeOriginal.has(tNode)) {
      if (!current.trim()) return;
      textNodeOriginal.set(tNode, current);
    }
    const orig = textNodeOriginal.get(tNode)!;
    const next = tr(orig);
    if (tNode.nodeValue !== next) {
      tNode.nodeValue = next;
    }
    return;
  }

  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const rootEl = root as Element;
  if (rootEl.matches(PROTECTED_SUBTREE_SELECTOR) || isInsideProtectedSubtree(rootEl)) {
    return;
  }

  translateElementAttributes(rootEl);

  const walker = document.createTreeWalker(
    rootEl,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as Element;
          if (el.matches(PROTECTED_SUBTREE_SELECTOR)) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  let curr: Node | null = walker.nextNode();
  while (curr) {
    if (curr.nodeType === Node.ELEMENT_NODE) {
      translateElementAttributes(curr as Element);
    } else if (curr.nodeType === Node.TEXT_NODE) {
      const tNode = curr as Text;
      const val = tNode.nodeValue || '';
      if (val.trim()) {
        if (!textNodeOriginal.has(tNode)) {
          textNodeOriginal.set(tNode, val);
        }
        const orig = textNodeOriginal.get(tNode)!;
        const next = tr(orig);
        if (tNode.nodeValue !== next) {
          tNode.nodeValue = next;
        }
      }
    }
    curr = walker.nextNode();
  }
}

function translateElementAttributes(el: Element): void {
  const ATTRS = ['placeholder', 'title', 'aria-label'] as const;
  let saved = attrOriginal.get(el);
  for (const attr of ATTRS) {
    const val = el.getAttribute(attr);
    if (!val || !val.trim()) continue;
    if (!saved) {
      saved = {};
      attrOriginal.set(el, saved);
    }
    if (!(attr in saved)) {
      saved[attr] = val;
    }
    const next = tr(saved[attr]);
    if (val !== next) {
      el.setAttribute(attr, next);
    }
  }
}

export function refreshEntireDocumentLanguage(): void {
  if (typeof document === 'undefined' || !document.body) return;
  const info = getActiveLanguageInfo();
  document.documentElement.lang = info.code;
  document.documentElement.dir = info.dir || 'ltr';

  isApplyingDom = true;
  try {
    translateDomSubtree(document.body);
  } finally {
    isApplyingDom = false;
  }
}

export function installDomI18nObserver(): void {
  if (domObserverInstalled || typeof document === 'undefined') return;
  domObserverInstalled = true;

  refreshEntireDocumentLanguage();

  const obs = new MutationObserver((mutations) => {
    if (isApplyingDom) return;
    isApplyingDom = true;
    try {
      for (const m of mutations) {
        if (m.type === 'childList') {
          m.addedNodes.forEach((n) => translateDomSubtree(n));
        } else if (m.type === 'characterData' && m.target.nodeType === Node.TEXT_NODE) {
          const tNode = m.target as Text;
          if (!isInsideProtectedSubtree(tNode)) {
            const val = tNode.nodeValue || '';
            if (val.trim()) {
              textNodeOriginal.set(tNode, val);
              const next = tr(val);
              if (tNode.nodeValue !== next) {
                tNode.nodeValue = next;
              }
            }
          }
        } else if (m.type === 'attributes' && m.target.nodeType === Node.ELEMENT_NODE) {
          const el = m.target as Element;
          if (!isInsideProtectedSubtree(el) && m.attributeName) {
            const val = el.getAttribute(m.attributeName);
            if (val && val.trim()) {
              let saved = attrOriginal.get(el);
              if (!saved) {
                saved = {};
                attrOriginal.set(el, saved);
              }
              saved[m.attributeName] = val;
              const next = tr(val);
              if (val !== next) {
                el.setAttribute(m.attributeName, next);
              }
            }
          }
        }
      }
    } finally {
      isApplyingDom = false;
    }
  });

  obs.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['placeholder', 'title', 'aria-label']
  });
}

function queueMissingUiString(phrase: string): void {
  if (shouldNeverTranslateString(phrase)) return;
  if (phrase.length > 220) return;
  pendingMissingStrings.add(phrase);
  if (typeof window !== 'undefined') {
    window.clearTimeout(batchTranslateTimer);
    batchTranslateTimer = window.setTimeout(() => {
      void flushMissingTranslationsForActiveLanguage();
    }, 120);
  }
}

async function flushMissingTranslationsForActiveLanguage(): Promise<void> {
  const targetLang = getActiveLanguageInfo();
  if (targetLang.code === 'pt-BR') {
    pendingMissingStrings.clear();
    return;
  }
  if (inflightPackPromise) return inflightPackPromise;

  const dict = getCombinedDictionary(targetLang.code);

  // Combine core canonical phrases + any newly discovered live DOM phrases not yet in dict
  const coreSeeds = [
    ...Object.keys(BUILTIN_PACKS.en),
    ...Object.keys(BUILTIN_PACKS['pt-BR']),
    '{n} etapas executadas',
    'Referências'
  ];
  for (const s of coreSeeds) {
    if (!dict[s] && !shouldNeverTranslateString(s)) {
      pendingMissingStrings.add(s);
    }
  }

  const missing = [...pendingMissingStrings].filter((s) => !dict[s]);
  pendingMissingStrings.clear();
  if (missing.length === 0) return;

  inflightPackPromise = (async () => {
    try {
      const CHUNK_SIZE = 95;
      const chunks: string[][] = [];
      for (let i = 0; i < missing.length; i += CHUNK_SIZE) {
        chunks.push(missing.slice(i, i + CHUNK_SIZE));
      }

      await Promise.all(
        chunks.map(async (chunk) => {
          const numberedInput: Record<string, string> = {};
          chunk.forEach((txt, idx) => {
            numberedInput[String(idx)] = txt;
          });

          const sys = `You are a professional 3D software localization engine translating UI strings into ${targetLang.enName} (${targetLang.nativeName}, BCP-47 code "${targetLang.code}").
Rules:
1. Return ONLY a valid JSON object mapping each numeric string key ("0", "1", ...) to its natural, concise ${targetLang.enName} (${targetLang.nativeName}) UI translation.
2. NEVER translate or alter the app name "Modix" or "Modix 3D".
3. NEVER alter placeholders like {n}, {q0}, {q1} or file extensions like .OBJ, .GLB, .GLTF, .STL, .PLY, .DAE, .USDZ, .MODIX, .PNG.
4. Do NOT include markdown fences or explanations — output pure JSON only.`;

          const res = await callOpenRouterChat(
            [
              { role: 'system', content: sys },
              { role: 'user', content: JSON.stringify(numberedInput) }
            ],
            ['google/gemini-2.5-flash', 'openai/gpt-4o-mini'],
            { temperature: 0.1, maxTokens: 4500 }
          );

          const cleaned = res.content.replace(/```json/gi, '').replace(/```/g, '').trim();
          const b0 = cleaned.indexOf('{');
          const b1 = cleaned.lastIndexOf('}');
          if (b0 !== -1 && b1 > b0) {
            const parsed = JSON.parse(cleaned.slice(b0, b1 + 1)) as Record<string, unknown>;
            chunk.forEach((srcPhrase, idx) => {
              const val = parsed[String(idx)];
              if (typeof val === 'string' && val.trim()) {
                dict[srcPhrase] = enforceBrandProtection(val.trim());
              }
            });
          }
        })
      );

      savePackToCache(targetLang.code, dict);
      if (activeLangCode === targetLang.code) {
        refreshEntireDocumentLanguage();
        listeners.forEach((fn) => fn(targetLang));
      }
    } catch {
      // Offline or network restricted: built-in + cached translations stay active cleanly
    } finally {
      inflightPackPromise = null;
    }
  })();

  return inflightPackPromise;
}

export async function setAppLanguage(code: string): Promise<void> {
  const found = WORLD_LANGUAGES.find((l) => l.code === code);
  if (!found) return;

  activeLangCode = found.code;
  try {
    localStorage.setItem(STORAGE_KEY_LANG, found.code);
  } catch {
    // ignore
  }

  refreshEntireDocumentLanguage();
  listeners.forEach((fn) => fn(found));

  if (found.code !== 'pt-BR') {
    await flushMissingTranslationsForActiveLanguage();
  }
}

/**
 * Opens the sleek pure-black searchable World Language Selector Modal (162 languages).
 */
export function openLanguageSelectorModal(onSelected?: (lang: WorldLanguageInfo) => void): void {
  document.querySelector('.modix-lang-modal-backdrop')?.remove();

  let query = '';
  let isApplying = false;

  const backdrop = document.createElement('div');
  backdrop.className = 'modix-modal-backdrop modix-lang-modal-backdrop';

  const renderModalContent = () => {
    const currentCode = getActiveLanguageCode();
    const filtered = searchWorldLanguages(query);

    backdrop.innerHTML = `
      <div class="modix-lang-modal" role="dialog" aria-modal="true">
        <div class="modix-lang-modal-hdr">
          <div class="modix-lang-modal-title">
            ${Icons.hubGlobe}
            <span>${escapeHtml(tr('Selecionar Idioma'))}</span>
          </div>
          <button type="button" class="modix-modal-close" data-close-lang title="${escapeHtml(tr('Fechar'))}">
            ${Icons.close}
          </button>
        </div>

        <div class="modix-lang-search-wrap">
          <span class="modix-lang-search-ico">${Icons.hubSearch}</span>
          <input
            type="text"
            id="modix-lang-search-inp"
            value="${escapeHtml(query)}"
            placeholder="${escapeHtml(tr('Pesquisar idioma...'))}"
            autocomplete="off"
          />
          ${
            query
              ? `<button type="button" class="modix-lang-clear-q" id="modix-lang-clear-btn">${Icons.close}</button>`
              : ''
          }
        </div>

        ${
          isApplying
            ? `<div class="modix-lang-sync-bar">
                <span class="modix-btn-spinner"></span>
                <span>${escapeHtml(tr('Traduzindo aplicativo...'))}</span>
               </div>`
            : ''
        }

        <div class="modix-lang-list" id="modix-lang-list">
          ${
            filtered.length === 0
              ? `<div class="modix-lang-empty">${escapeHtml(tr('Nenhum idioma encontrado.'))}</div>`
              : filtered
                  .map((lang) => {
                    const active = lang.code === currentCode;
                    return `
                      <button
                        type="button"
                        class="modix-lang-item ${active ? 'active' : ''}"
                        data-lang-code="${escapeHtml(lang.code)}"
                        ${isApplying ? 'disabled' : ''}
                      >
                        <div class="modix-lang-item-copy" data-no-i18n="true">
                          <span class="modix-lang-native">${escapeHtml(lang.nativeName)}</span>
                          <span class="modix-lang-sub">${escapeHtml(lang.ptName)} · ${escapeHtml(lang.enName)}</span>
                        </div>
                        <span class="modix-lang-check">${active ? Icons.check : `<span class="modix-lang-code" data-no-i18n="true">${escapeHtml(lang.code)}</span>`}</span>
                      </button>
                    `;
                  })
                  .join('')
          }
        </div>
      </div>
    `;

    backdrop
      .querySelector('[data-close-lang]')
      ?.addEventListener('click', () => backdrop.remove());

    const inp = backdrop.querySelector<HTMLInputElement>('#modix-lang-search-inp');
    if (inp) {
      inp.focus();
      const len = inp.value.length;
      inp.setSelectionRange(len, len);
      inp.addEventListener('input', () => {
        query = inp.value;
        renderModalContent();
      });
    }

    backdrop.querySelector('#modix-lang-clear-btn')?.addEventListener('click', () => {
      query = '';
      renderModalContent();
    });

    backdrop.querySelectorAll<HTMLButtonElement>('[data-lang-code]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (isApplying) return;
        const code = btn.dataset.langCode || 'pt-BR';
        const chosen = WORLD_LANGUAGES.find((l) => l.code === code);
        if (!chosen) return;
        isApplying = true;
        renderModalContent();
        await setAppLanguage(code);
        isApplying = false;
        backdrop.remove();
        onSelected?.(chosen);
      });
    });
  };

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop && !isApplying) backdrop.remove();
  });

  document.body.appendChild(backdrop);
  renderModalContent();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
