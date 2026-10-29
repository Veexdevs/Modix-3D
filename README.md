<p align="center">
  <img src="assets/splash-logo.png" alt="Modix 3D Logo" width="220" />
</p>

<h1 align="center">Modix 3D</h1>

<p align="center">
  <strong>Estudio Mobile de Modelagem 3D, Escultura, Pintura de Texturas e Agente Multi-IA (Preto e Branco — Landscape / Tela Deitada)</strong><br/>
  Disponivel nativamente como <code>.apk</code> (Android) e <code>.ipa</code> (iOS) compilados automaticamente via <strong>GitHub Actions</strong>.
</p>

<p align="center">
  <img src="assets/editor-preview.png" alt="Modix 3D Editor Landscape" width="900" />
</p>

---

## Download (`.apk` e `.ipa`)

Cada push ou execucao na aba **[Actions](../../actions)** gera automaticamente os instaladores nativos:

- **`Modix-3D-APK` (`Modix-3D.apk`)**: Aplicativo Android assinado (esquemas V1 + V2), pronto para instalar diretamente em qualquer smartphone ou tablet Android em **tela deitada (`sensorLandscape` fullscreen imersivo)**.
- **`Modix-3D-IPA` (`Modix-3D.ipa`)**: Aplicativo iOS (`arm64` / `iphoneos`) assinado ad-hoc, pronto para instalacao via **AltStore, SideStore, Sideloadly, TrollStore** ou Xcode, travado em **Landscape Left / Right** em tela cheia.

Para publicar tambem uma Release oficial com `.apk` e `.ipa` anexados:
1. Envie uma tag `v*` (ex.: `git tag v3.0.0 && git push origin v3.0.0`), **ou**
2. Na aba **Actions -> Build Modix 3D Mobile (APK & IPA) -> Run workflow**, marque `create_release: true`.

---

## Principais Recursos

### 1. Conta com E-mail & Tela Inicial Exclusiva de Projetos
- **Autenticacao Obrigatoria por E-mail**: Ao abrir o aplicativo pela primeira vez, o usuario cria sua conta ou faz login com e-mail e senha (sincronizado com banco em nuvem Supabase + cache local resiliente).
- **Tela Inicial Focada em Projetos**: Sempre que o app abre, inicia diretamente na tela exclusiva de **Meus Projetos** e **Criar Projeto**, com miniaturas automaticas e salvamento continuo.
- **Perfil no Canto Superior Direito**: Exibe a **foto da conta/e-mail** e o **nome do usuario** no canto superior direito da tela de projetos, com menu rapido para **alterar foto**, **editar nome**, **sair da conta** ou **deletar permanentemente a conta e todos os dados**.

### 2. Interface 100% Vetorial (Icones SVG, Zero Emojis)
- Toda a interface preta e branca do Modix 3D utiliza exclusivamente **icones vetoriais SVG** personalizados de alta nitidez em todos os menus, barras de ferramentas, Explorer, Propriedades, Estudio de Texturas e painel de IA.

### 3. Chat de IA & Agente Multi-IA 3D (`OpenRouter`)
Botao **`IA / Agente`** na barra superior abre a central de Inteligencia Artificial com alternancia instantanea entre dois modos:
- **Modo `IA` (Chat & Duvidas)**: Responde perguntas tecnicas de modelagem 3D, topologia, UVs e materiais com consciencia da cena atual, **sem modificar nenhum objeto**.
- **Modo `Agente` (Pipeline Multi-IA Colaborativo)**: Orquestra multiplas IAs especialistas trabalhando em conjunto:
  1. **IA Arquiteta 3D**: Planeja proporcoes, partes estruturais, cortes geometricos, grupos e materiais.
  2. **IA Modeladora & Escultora**: Constroi primitivas, perfis extrudados (`add_extruded_polygon`), malhas torneadas (`add_lathe`), modificadores, cortes por plano 3D (`slice_mesh`), uniao (`join_objects`) e grupos (`group_objects`).
  3. **IA Artista de Texturas (em paralelo)**: Desenha texturas vetoriais `SVG` exclusivas em `512x512` convertidas em mapas `PNG` ou aplica texturas procedurais PBR automaticamente nos objetos criados.
  - Inclui **Undo 3D em 1 toque** para reverter qualquer criacao inteira do Agente instantaneamente.

### 4. Operacoes Completas de Objetos, Hierarquia & Malhas
- **24 Formas 3D Prontas**: `Cube`, `Plane`, `Grid`, `UV Sphere`, `Ico Sphere`, `Cylinder`, `Cone`, `Torus`, `Capsule`, `Monkey`, `Wedge`, `Corner Wedge`, `Pyramid`, `Prism`, `Hex Cylinder`, `Pipe`, `Arch`, `Stairs`, `Star 3D`, `Gear`, `Ring`, `Crystal`, `Heart 3D` e `Torus Knot`.
- **Explorer / Outliner Redimensionavel**: Segure a barra inferior do Explorer e arraste para cima ou para baixo para ajustar o tamanho livremente por toque ou mouse.
- **Grupos / Colecoes, Renomear, Copiar, Colar, Recortar & Unir**:
  - **Renomear** objetos e grupos (toque duplo no Explorer, menu de acoes ou `F2`).
  - **Agrupar / Desagrupar** (`Ctrl+G`, botao de novo grupo no Explorer, mover objetos entre colecoes).
  - **Copiar (`Ctrl+C`), Recortar (`Ctrl+X`), Colar (`Ctrl+V`), Duplicar (`Shift+D`) e Deletar (`X`/`Del`)**.
  - **Unir Malhas (`Ctrl+J` / Join)** preservando transformacoes em espaco global + **Separar Partes Soltas (`Separate Loose Parts`)**.
  - **Recortar / Fatiar Malha 3D (`Slice / Cut 3D`)**: Corta qualquer objeto por plano `X`, `Y` ou `Z` mantendo um lado ou dividindo em 2 pecas solidas fechadas (`capped`).

### 5. Estudio 2D de Desenho de Texturas & Pintura 3D Direta
- **Estudio 2D (`512x512`)**: Pincel suave, aerografo, linha, retangulo, circulo, balde de tinta (`flood fill`), borracha, espelhamento X/Y, guia de grade UV, 25 niveis de Undo/Redo, importacao de imagem da galeria e exportacao `.png`.
- **14 Geradores Procedurais Instantaneos**: `Plastic Studs`, `Checker`, `Grid UV`, `Brick`, `Wood`, `Carbon Fiber`, `Metal Plate`, `Camo`, `Lava`, `Grass`, `Stone`, `Sci-Fi Panel`, `Gradient` e `Noise`.
- **Pintura 3D Direta na Viewport (`Texture Paint`)**: Pinte diretamente sobre a superficie 3D do modelo com atualizacao a 60fps via `CanvasTexture` + projecoes UV (`Box`, `Planar`, `Cylindrical`, `Spherical`) e repeticao `Repeat X/Y`.

### 6. Exportacao & Importacao 3D Universal
Cada formato segue rigorosamente sua especificacao oficial para abrir corretamente em todos os softwares e engines que o aceitam:
- **`.OBJ` (Wavefront Y-up ou Z-up) + `.MTL` + `.PNG`**: Conversao automatica `Z-up -> Y-up` (`det = +1`, preservando normais externas sem faces invertidas), malha triangulada `f v/vt/vn` e coordenadas UV completas para engines de jogos, renderizadores e editores 3D.
- **`.GLB` e `.GLTF` (glTF 2.0 PBR)**: Cena PBR dedicada com `MeshStandardMaterial` e texturas PNG embutidas em sRGB.
- **`.USDZ` (Universal Scene Description)**: Pacote nativo com malhas e materiais `MeshStandardMaterial` para visualizacao 3D e AR no iOS/macOS.
- **`.STL` (Binario) e `.PLY` (Cores + Normais)**: Geometria fechada para fatiadores de impressao 3D, CAD e escaneamento.
- **`.DAE` (COLLADA 1.4.1)**: Cena XML estruturada com posicoes, normais, UVs e materiais.
- **Importacao Universal (11 formatos)**: `.obj`, `.fbx`, `.glb`, `.gltf`, `.dae`, `.stl`, `.ply`, `.3mf`, `.amf`, `.svg` (extrusao automatica para 3D), `.off` e `.modix`.

---

## Compilacao Local

```bash
npm install
npm run build
npx cap sync
```

- **Android APK**:
  ```bash
  cd android && ./gradlew assembleRelease
  ```
- **iOS IPA (macOS + Xcode)**:
  ```bash
  xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release -sdk iphoneos build
  ```
